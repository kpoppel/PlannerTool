/**
 * CapacityCalculator Service
 * Calculates team/project capacity from features
 * Fully compatible with legacy capacity calculation
 */

import { CapacityEvents } from '../core/EventRegistry.js';
import { isEnabled } from '../config.js';
import { resolveFundedTargetProject } from '../application/shared/ownership.js';

// Special project ID for unfunded/orphaned allocations
const UNFUNDED_PROJECT_ID = '__unfunded__';

export class CapacityCalculator {
  constructor(eventBus, childrenByParentMap = null) {
    this.bus = eventBus;
    this.childrenByParent = childrenByParentMap || new Map();
    // Caches for incremental updates
    this._lastResultCache = null; // { dates, teamDaily, teamDailyMap, projectDaily, projectDailyMap, totalOrgDaily }
    this._lastFeaturesById = new Map(); // featureId -> feature (last seen)
    /** @type {(Map<string, number> & {_key?: string})|null} */
    this._dateIndexMap = null; // dateIso -> index
  }

  /**
   * Set children by epic map (needed for epic capacity mode)
   * @param {Map} childrenByParent - Map of epic ID to array of child feature IDs
   */
  setChildrenByParent(childrenByParent) {
    this.childrenByParent = childrenByParent;
  }

  /**
   * Calculate capacity metrics from features
   * @param {Array} features - Array of features
   * @param {Object} filters - { selectedProjects, selectedTeams, selectedStates }
   * @param {Array} teams - Array of team objects with id
   * @param {Array} projects - Array of project objects with id
   * @returns {Object} Capacity metrics in legacy tuple format
   *
   * Note: This method adds a synthetic '__unfunded__' project to track allocations
   * that don't roll up to any type='project' project. Consumers should check for
   * '__unfunded__' in projectDailyCapacityMap or at the last index in projectDailyCapacity tuples.
   */
  // Optional 5th param: changedFeatureIds (Array) for incremental updates
  calculate(features, filters, teams, projects, changedFeatureIds = null) {
    const { selectedProjects = [], selectedTeams = [], selectedStates = [] } = filters;

    // Validate inputs
    if (
      !teams ||
      teams.length === 0 ||
      !features ||
      features.length === 0 ||
      !projects ||
      projects.length === 0
    ) {
      return this._emptyResult();
    }

    // Selected plans and task states define calculation scope. Team Drill-down
    // is presentation-only and must not alter organization-wide capacity.
    if (
      selectedProjects.length === 0 ||
      selectedStates.length === 0
    ) {
      return this._emptyResult();
    }

    // Generate date range
    const dates = this._generateDateRange(features);
    if (dates.length === 0) {
      return this._emptyResult();
    }

    // Add synthetic unfunded project and include in calculations
    const unfundedProject = {
      id: UNFUNDED_PROJECT_ID,
      type: 'project',
      name: 'Unfunded',
      color: '#000000',
    };
    const allProjects = [...projects, unfundedProject];

    // Build team and project index maps
    const teamIndexById = new Map();
    teams.forEach((t, idx) => teamIndexById.set(t.id, idx));

    const projectIndexById = new Map();
    allProjects.forEach((p, idx) => projectIndexById.set(p.id, idx));

    // Build project lookup for type checking
    const projectById = new Map(allProjects.map((p) => [String(p.id), p]));
    const fundedTargetMemo = new Map();

    // Build feature lookup for epic-child checks
    const effectiveById = new Map(features.map((f) => [f.id, f]));

    // Build/refresh date index map for fast ISO->index lookup
    const datesKey = dates.join('|');
    if (!this._dateIndexMap || this._dateIndexMap._key !== datesKey) {
      const map = /** @type {Map<string, number> & {_key?: string}} */ (new Map());
      dates.forEach((d, i) => map.set(d, i));
      map._key = datesKey;
      this._dateIndexMap = map;
    }

    // If incremental update requested and we have a compatible cache, apply deltas
    if (
      Array.isArray(changedFeatureIds) &&
      this._lastResultCache &&
      this._lastResultCache.dates.length === dates.length
    ) {
      this._applyFeatureDeltas(changedFeatureIds, effectiveById, {
        selectedProjects,
        selectedStates,
        teams,
        projects: allProjects,
        teamIndexById,
        projectIndexById,
        projectById,
        dates,
      });

      const cached = this._lastResultCache;
      // The full organization roster establishes a stable denominator.
      const nOrganizationTeams = teams.length;
      const projectDailyNormalized = cached.projectDaily.map((tuple) =>
        tuple.map((v) => v / nOrganizationTeams)
      );
      const totalOrgDailyPerTeamAvg = cached.totalOrgDaily.map(
        (v) => v / nOrganizationTeams
      );

      const result = {
        dates: cached.dates,
        teamDailyCapacity: cached.teamDaily,
        teamDailyCapacityMap: cached.teamDailyMap,
        projectDailyCapacityRaw: cached.projectDaily,
        projectDailyCapacity: projectDailyNormalized,
        projectDailyCapacityMap: cached.projectDailyMap,
        totalOrgDailyCapacity: cached.totalOrgDaily,
        totalOrgDailyPerTeamAvg,
      };
      result.totalOrgDaily = cached.totalOrgDaily;
      this.bus.emit(CapacityEvents.UPDATED);
      return result;
    }

    // Full calculation (feature-first) for best average performance
    const { teamDaily, teamDailyMap, projectDaily, projectDailyMap, totalOrgDaily } =
      this._calculateDailyCapacities_FeatureFirst(
        features,
        dates,
        selectedProjects,
        selectedStates,
        teams,
        teamIndexById,
        projectIndexById,
        projectById,
        effectiveById
      );

    // The full organization roster establishes a stable denominator.
    const nOrganizationTeams = teams.length;
    const projectDailyNormalized = projectDaily.map((tuple) =>
      tuple.map((v) => v / nOrganizationTeams)
    );
    const totalOrgDailyPerTeamAvg = totalOrgDaily.map((v) => v / nOrganizationTeams);

    const result = {
      dates,
      teamDailyCapacity: teamDaily,
      teamDailyCapacityMap: teamDailyMap,
      projectDailyCapacityRaw: projectDaily,
      projectDailyCapacity: projectDailyNormalized,
      projectDailyCapacityMap: projectDailyMap,
      totalOrgDailyCapacity: totalOrgDaily,
      totalOrgDailyPerTeamAvg,
    };
    // Backwards-compatible alias expected by some callers/tests
    result.totalOrgDaily = totalOrgDaily;

    // Cache result for incremental updates
    this._lastResultCache = {
      dates,
      teamDaily,
      teamDailyMap,
      projectDaily,
      projectDailyMap,
      totalOrgDaily,
    };
    // Store snapshot of features for delta subtraction
    this._lastFeaturesById = new Map(features.map((f) => [f.id, f]));

    // Emit event
    this.bus.emit(CapacityEvents.UPDATED);

    return result;
  }

  // Feature-first calculation (efficient when features cover short ranges)
  _calculateDailyCapacities_FeatureFirst(
    features,
    dates,
    selectedProjects,
    selectedStates,
    teams,
    teamIndexById,
    projectIndexById,
    projectById,
    effectiveById
  ) {
    const dlen = dates.length;
    const tlen = teams.length;
    const plen = projectIndexById.size;

    const teamDaily = Array.from({ length: dlen }, () => new Array(tlen).fill(0));
    const teamDailyMap = Array.from({ length: dlen }, () => ({}));
    const projectDaily = Array.from({ length: dlen }, () => new Array(plen).fill(0));
    const projectDailyMap = Array.from({ length: dlen }, () => ({}));
    const totalOrgDaily = new Array(dlen).fill(0);

    const selectedProjectSet = new Set(selectedProjects);
    const selectedStateSet = new Set(selectedStates);
    const fundedTargetMemo = new Map();

    const dateIndex = this._dateIndexMap;
    if (!dateIndex) {
      return {
        teamDaily,
        teamDailyMap,
        projectDaily,
        projectDailyMap,
        totalOrgDaily,
      };
    }

    for (const f of features) {
      if (!f || !f.start || !f.end) continue;
      if (!selectedProjectSet.has(f.project)) continue;
      const fState = f.state;
      if (!selectedStateSet.has(fState)) continue;

      const childIds = this.childrenByParent.get(f.id) || [];
      if (childIds.length && !isEnabled('USE_PARENT_CAPACITY_GAP_FILLS')) continue;

      const startIdx = dateIndex.get(f.start);
      const endIdx = dateIndex.get(f.end);
      if (startIdx === undefined || endIdx === undefined) continue;

      // Team-aware child precedence: build the set of teams whose capacity is already
      // covered by at least one child. A team in this set contributed estimates at a
      // finer level, so we suppress ALL parent-level allocation for that team across
      // the entire parent date range (including days the children don't cover).
      // Teams that have no children continue to show the parent estimate normally.
        /** @type {Set<string>|null} */
        let teamsWithChildren = null;
      if (childIds.length) {
          teamsWithChildren = new Set();
        for (const cid of childIds) {
          const ch = effectiveById.get(cid);
          if (!ch) continue;
          for (const ctl of (ch.capacity || [])) {
              teamsWithChildren.add(String(ctl.team));
          }
        }
      }

      const tls = f.capacity || [];
      for (let di = startIdx; di <= endIdx; di++) {
        let projectLoadForDay = 0;
        for (const tl of tls) {
          // Children take full precedence for their team: if this parent has a child
          // with capacity for this team, skip the parent's contribution entirely.
          if (teamsWithChildren && teamsWithChildren.has(String(tl.team))) continue;
          const ti = teamIndexById.get(tl.team);
          const load = Number(tl.capacity) || 0;
          if (ti !== undefined) {
            teamDaily[di][ti] += load;
            teamDailyMap[di][tl.team] = (teamDailyMap[di][tl.team] || 0) + load;
          }

          const targetProjectId = resolveFundedTargetProject(
            f,
            effectiveById,
            projectById,
            fundedTargetMemo
          ) || UNFUNDED_PROJECT_ID;

          const pi = projectIndexById.get(targetProjectId);
          if (pi !== undefined) {
            projectDaily[di][pi] += load;
            projectDailyMap[di][targetProjectId] =
              (projectDailyMap[di][targetProjectId] || 0) + load;
            projectLoadForDay += load;
          }
        }
        totalOrgDaily[di] += projectLoadForDay;
      }
    }

    return {
      teamDaily,
      teamDailyMap,
      projectDaily,
      projectDailyMap,
      totalOrgDaily,
    };
  }

  // Apply deltas for changed features (subtract old contribution, add new)
  _applyFeatureDeltas(changedIds, effectiveById, ctx) {
    const {
      selectedProjects,
      selectedStates,
      teams,
      projects,
      teamIndexById,
      projectIndexById,
      projectById,
      dates,
    } = ctx;

    const cache = this._lastResultCache;
    if (!cache) return;

    const dateIndex = this._dateIndexMap;
    if (!dateIndex) return;
    const teamDaily = cache.teamDaily;
    const projectDaily = cache.projectDaily;
    const teamDailyMap = cache.teamDailyMap;
    const projectDailyMap = cache.projectDailyMap;
    const totalOrgDaily = cache.totalOrgDaily;

    const selectedProjectSet = new Set(selectedProjects);
    const selectedStateSet = new Set(selectedStates);
    const fundedTargetMemo = new Map();

    // Expand the set of IDs to process beyond just the directly changed ones.
    // When a child's capacity changes, the parent's effective contribution also
    // changes (teamsWithChildren suppresses parent capacity for teams children cover).
    // We must reprocess the parent too so the cache stays correct.
    const allChangedIds = new Set(changedIds);
    for (const id of changedIds) {
      const f = effectiveById.get(id) || this._lastFeaturesById.get(id);
      if (f && f.parentId) {
        allChangedIds.add(f.parentId);
      }
    }

    // processFeature adjusts the cache arrays by `sign` (+1 or -1) for feature `f`.
    // `childSource` controls which map is used to build teamsWithChildren: the subtract
    // pass uses _lastFeaturesById (old child state) and the add pass uses effectiveById
    // (new child state).  This is critical: using the same childSource for both passes
    // would fail to remove the parent's old contribution when a child gains capacity.
    const processFeature = (f, sign, childSource) => {
      if (!f || !f.start || !f.end) return;
      if (!selectedProjectSet.has(f.project)) return;
      const fState = f.state;
      if (!selectedStateSet.has(fState)) return;

      const childIds = this.childrenByParent.get(f.id) || [];
      if (childIds.length && !isEnabled('USE_PARENT_CAPACITY_GAP_FILLS')) return;

      const startIdx = dateIndex.get(f.start);
      const endIdx = dateIndex.get(f.end);
      if (startIdx === undefined || endIdx === undefined) return;

      /** @type {Set<string>|null} */
      let teamsWithChildren = null;
      if (childIds.length) {
        teamsWithChildren = new Set();
        for (const cid of childIds) {
          const ch = childSource.get(cid);
          if (!ch) continue;
          for (const ctl of (ch.capacity || [])) {
            teamsWithChildren.add(String(ctl.team));
          }
        }
      }

      const tls = f.capacity || [];
      for (let di = startIdx; di <= endIdx; di++) {
        let projectLoadForDay = 0;
        for (const tl of tls) {
          // Children take full precedence for their team.
          if (teamsWithChildren && teamsWithChildren.has(String(tl.team))) continue;
          const ti = teamIndexById.get(tl.team);
          const load = Number(tl.capacity) || 0;
          if (ti !== undefined) {
            teamDaily[di][ti] += sign * load;
            teamDailyMap[di][tl.team] = (teamDailyMap[di][tl.team] || 0) + sign * load;
          }

          const targetProjectId = resolveFundedTargetProject(
            f,
            effectiveById,
            projectById,
            fundedTargetMemo
          ) || UNFUNDED_PROJECT_ID;

          const pi = projectIndexById.get(targetProjectId);
          if (pi !== undefined) {
            projectDaily[di][pi] += sign * load;
            projectDailyMap[di][targetProjectId] =
              (projectDailyMap[di][targetProjectId] || 0) + sign * load;
            projectLoadForDay += load;
          }
        }
        totalOrgDaily[di] += sign * projectLoadForDay;
      }
    };

    // Pass 1 – subtract old contributions using the ORIGINAL _lastFeaturesById for
    // ALL ids before any snapshots are updated.  This guarantees that when a child
    // change causes the parent to be included in allChangedIds, the parent subtract
    // sees the old child state (teamA not yet in teamsWithChildren) and correctly
    // removes the parent's old teamA contribution from the cache.
    for (const id of allChangedIds) {
      const oldF = this._lastFeaturesById.get(id) || null;
      if (oldF) processFeature(oldF, -1, this._lastFeaturesById);
    }

    // Pass 2 – add new contributions using effectiveById (new child state) so parent
    // suppression correctly reflects the live teamsWithChildren.
    for (const id of allChangedIds) {
      const newF = effectiveById.get(id) || null;
      if (newF) processFeature(newF, +1, effectiveById);
    }

    // Pass 3 – update stored snapshots after all cache adjustments are complete.
    for (const id of allChangedIds) {
      const newF = effectiveById.get(id) || null;
      if (newF) {
        const snapshot = { ...newF };
        if (Array.isArray(newF.capacity)) {
          snapshot.capacity = newF.capacity.map((c) => ({ ...c }));
        }
        this._lastFeaturesById.set(id, snapshot);
      } else {
        this._lastFeaturesById.delete(id);
      }
    }
  }

  _emptyResult() {
    return {
      dates: [],
      teamDailyCapacity: [],
      teamDailyCapacityMap: [],
      projectDailyCapacityRaw: [],
      projectDailyCapacity: [],
      projectDailyCapacityMap: [],
      totalOrgDailyCapacity: [],
      totalOrgDailyPerTeamAvg: [],
    };
  }

  _generateDateRange(features) {
    if (features.length === 0) return [];

    let minStart = null;
    let maxEnd = null;

    for (const f of features) {
      if (!f || !f.start || !f.end) continue;
      const s = f.start;
      const e = f.end;
      if (minStart === null || s < minStart) minStart = s;
      if (maxEnd === null || e > maxEnd) maxEnd = e;
    }

    if (!minStart || !maxEnd) return [];

    // Generate inclusive list of ISO date strings
    const dates = [];
    const startDate = new Date(minStart);
    const endDate = new Date(maxEnd);

    // Normalize to midnight UTC
    const cur = new Date(
      Date.UTC(
        startDate.getUTCFullYear(),
        startDate.getUTCMonth(),
        startDate.getUTCDate()
      )
    );
    const end = new Date(
      Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate())
    );

    while (cur <= end) {
      const iso = new Date(cur).toISOString().slice(0, 10);
      dates.push(iso);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    return dates;
  }

  _calculateDailyCapacities(
    features,
    dates,
    selectedProjects,
    selectedStates,
    teams,
    teamIndexById,
    projectIndexById,
    effectiveById
  ) {
    const teamDaily = new Array(dates.length);
    const teamDailyMap = new Array(dates.length);
    const projectDaily = new Array(dates.length);
    const projectDailyMap = new Array(dates.length);
    const totalOrgDaily = new Array(dates.length);

    const selectedProjectSet = new Set(selectedProjects);
    const selectedStateSet = new Set(selectedStates);

    for (let di = 0; di < dates.length; di++) {
      const dayIso = dates[di];
      const teamTuple = new Array(teams.length).fill(0);
      const projectTuple = new Array(projectIndexById.size).fill(0);
      const teamMap = {};
      const projectMap = {};

      for (const f of features) {
        if (!f || !f.start || !f.end) continue;

        // Check if day is within feature date range
        if (dayIso < f.start || dayIso > f.end) continue;

        // Filter by selected projects
        if (!selectedProjectSet.has(f.project)) continue;

        // Filter by selected states
        const fState = f.state;
        if (!selectedStateSet.has(fState)) continue;

        // Handle epic capacity based on mode
        if ((this.childrenByParent.get(f.id) || []).length > 0) {
          if (!isEnabled('USE_PARENT_CAPACITY_GAP_FILLS')) {
            const childIds = this.childrenByParent.get(f.id) || [];
            if (childIds.length) continue; // Skip epic if has children
          } else if (isEnabled('USE_PARENT_CAPACITY_GAP_FILLS')) {
            const childIds = this.childrenByParent.get(f.id) || [];
            if (childIds.length) {
              // Check if any child covers this day
              let childCovers = false;
              for (const cid of childIds) {
                const ch = effectiveById.get(cid);
                if (!ch || !ch.start || !ch.end) continue;
                if (dayIso >= ch.start && dayIso <= ch.end) {
                  childCovers = true;
                  break;
                }
              }
              if (childCovers) continue; // Skip epic if child covers this day
            }
          }
        }

        // Process capacity allocations
        const tls = f.capacity || [];
        for (const tl of tls) {
          const ti = teamIndexById.get(tl.team);
          if (ti !== undefined) {
            const load = Number(tl.capacity) || 0;
            teamTuple[ti] += load;
            teamMap[tl.team] = (teamMap[tl.team] || 0) + load;
          }

          // Add to project capacity
          const pi = projectIndexById.get(f.project);
          if (pi !== undefined) {
            const load = Number(tl.capacity) || 0;
            projectTuple[pi] += load;
            projectMap[f.project] = (projectMap[f.project] || 0) + load;
          }
        }
      }

      teamDaily[di] = teamTuple;
      teamDailyMap[di] = teamMap;
      projectDaily[di] = projectTuple;
      projectDailyMap[di] = projectMap;

      // Calculate total org capacity (sum of all project capacities)
      const sumProjects = projectTuple.reduce((a, b) => a + b, 0);
      totalOrgDaily[di] = sumProjects;
    }

    return {
      teamDaily,
      teamDailyMap,
      projectDaily,
      projectDailyMap,
      totalOrgDaily,
    };
  }
}
