/**
 * CapacityCalculator Service
 * Calculates team/project capacity from features
 * Fully compatible with legacy capacity calculation
 */

import { CapacityEvents } from '../core/EventRegistry.js';
import { isEnabled } from '../config.js';

export class CapacityCalculator {
  constructor(eventBus, childrenByEpicMap = null) {
    this.bus = eventBus;
    this.childrenByEpic = childrenByEpicMap || new Map();
    // Caches for incremental updates
    this._lastResultCache = null;          // { dates, teamDaily, teamDailyMap, projectDaily, projectDailyMap, totalOrgDaily }
    this._lastFeaturesById = new Map();    // featureId -> feature (last seen)
    this._dateIndexMap = null;             // dateIso -> index
  }
  
  /**
   * Set children by epic map (needed for epic capacity mode)
   * @param {Map} childrenByEpic - Map of epic ID to array of child feature IDs
   */
  setChildrenByEpic(childrenByEpic) {
    this.childrenByEpic = childrenByEpic;
  }
  
  /**
   * Calculate capacity metrics from features
   * @param {Array} features - Array of features
   * @param {Object} filters - { selectedProjects, selectedTeams, selectedStates }
   * @param {Array} teams - Array of team objects with id
   * @param {Array} projects - Array of project objects with id
   * @returns {Object} Capacity metrics in legacy tuple format
   */
  // Optional 5th param: changedFeatureIds (Array) for incremental updates
  calculate(features, filters, teams, projects, changedFeatureIds = null) {
    const { selectedProjects = [], selectedTeams = [], selectedStates = [] } = filters;
    
    // Validate inputs
    if (!teams || teams.length === 0 || !features || features.length === 0 || !projects || projects.length === 0) {
      return this._emptyResult();
    }
    
    // Check for empty selections
    if (selectedProjects.length === 0 || selectedTeams.length === 0 || selectedStates.length === 0) {
      return this._emptyResult();
    }
    
    // Generate date range
    const dates = this._generateDateRange(features);
    if (dates.length === 0) {
      return this._emptyResult();
    }
    
    // Build team and project index maps
    const teamIndexById = new Map();
    teams.forEach((t, idx) => teamIndexById.set(t.id, idx));
    
    const projectIndexById = new Map();
    projects.forEach((p, idx) => projectIndexById.set(p.id, idx));
    
    // Build feature lookup for epic-child checks
    const effectiveById = new Map(features.map(f => [f.id, f]));

    // Build/refresh date index map for fast ISO->index lookup
    const datesKey = dates.join('|');
    if (!this._dateIndexMap || this._dateIndexMap._key !== datesKey) {
      const map = new Map();
      dates.forEach((d, i) => map.set(d, i));
      map._key = datesKey;
      this._dateIndexMap = map;
    }

    // If incremental update requested and we have a compatible cache, apply deltas
    if (Array.isArray(changedFeatureIds) && this._lastResultCache && this._lastResultCache.dates.length === dates.length) {
      this._applyFeatureDeltas(changedFeatureIds, effectiveById, {
        selectedProjects,
        selectedTeams,
        selectedStates,
        teams,
        projects,
        teamIndexById,
        projectIndexById,
        dates
      });

      const cached = this._lastResultCache;
      // Normalize project capacities
      const nTeams = teams.length || 1;
      const projectDailyNormalized = cached.projectDaily.map(tuple => tuple.map(v => v / nTeams));
      const totalOrgDailyPerTeamAvg = cached.totalOrgDaily.map(v => v / nTeams);

      const result = {
        dates: cached.dates,
        teamDailyCapacity: cached.teamDaily,
        teamDailyCapacityMap: cached.teamDailyMap,
        projectDailyCapacityRaw: cached.projectDaily,
        projectDailyCapacity: projectDailyNormalized,
        projectDailyCapacityMap: cached.projectDailyMap,
        totalOrgDailyCapacity: cached.totalOrgDaily,
        totalOrgDailyPerTeamAvg
      };
      result.totalOrgDaily = cached.totalOrgDaily;
      this.bus.emit(CapacityEvents.UPDATED, result);
      return result;
    }

    // Full calculation (feature-first) for best average performance
    const {
      teamDaily,
      teamDailyMap,
      projectDaily,
      projectDailyMap,
      totalOrgDaily
    } = this._calculateDailyCapacities_FeatureFirst(
      features,
      dates,
      selectedProjects,
      selectedTeams,
      selectedStates,
      teams,
      teamIndexById,
      projectIndexById,
      effectiveById
    );
    
    // Normalize project capacities
    const nTeams = teams.length || 1;
    const projectDailyNormalized = projectDaily.map(tuple => tuple.map(v => v / nTeams));
    const totalOrgDailyPerTeamAvg = totalOrgDaily.map(v => v / nTeams);
    
    const result = {
      dates,
      teamDailyCapacity: teamDaily,
      teamDailyCapacityMap: teamDailyMap,
      projectDailyCapacityRaw: projectDaily,
      projectDailyCapacity: projectDailyNormalized,
      projectDailyCapacityMap: projectDailyMap,
      totalOrgDailyCapacity: totalOrgDaily,
      totalOrgDailyPerTeamAvg
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
      totalOrgDaily
    };
    // Store snapshot of features for delta subtraction
    this._lastFeaturesById = new Map(features.map(f => [f.id, f]));

    // Emit event
    this.bus.emit(CapacityEvents.UPDATED, result);
    
    return result;
  }

  // Feature-first calculation (efficient when features cover short ranges)
  _calculateDailyCapacities_FeatureFirst(
    features,
    dates,
    selectedProjects,
    selectedTeams,
    selectedStates,
    teams,
    teamIndexById,
    projectIndexById,
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
    const selectedTeamSet = new Set(selectedTeams);
    const selectedStateSet = new Set(selectedStates);

    const dateIndex = this._dateIndexMap;

    for (const f of features) {
      if (!f || !f.start || !f.end) continue;
      if (!selectedProjectSet.has(f.project)) continue;
      const fState = f.status || f.state;
      if (!selectedStateSet.has(fState)) continue;

      if (f.type === 'epic') {
        const childIds = this.childrenByEpic.get(f.id) || [];
        if (!isEnabled('USE_EPIC_CAPACITY_GAP_FILLS') && childIds.length) continue;
      }

      const startIdx = dateIndex.get(f.start);
      const endIdx = dateIndex.get(f.end);
      if (startIdx === undefined || endIdx === undefined) continue;

      const tls = f.capacity || [];
      for (let di = startIdx; di <= endIdx; di++) {
        if (f.type === 'epic' && isEnabled('USE_EPIC_CAPACITY_GAP_FILLS')) {
          const childIds = this.childrenByEpic.get(f.id) || [];
          if (childIds.length) {
            let childCovers = false;
            for (const cid of childIds) {
              const ch = effectiveById.get(cid);
              if (!ch || !ch.start || !ch.end) continue;
              if (dates[di] >= ch.start && dates[di] <= ch.end) { childCovers = true; break; }
            }
            if (childCovers) continue;
          }
        }

        let projectLoadForDay = 0;
        for (const tl of tls) {
          if (!selectedTeamSet.has(tl.team)) continue;
          const ti = teamIndexById.get(tl.team);
          const load = Number(tl.capacity) || 0;
          if (ti !== undefined) {
            teamDaily[di][ti] += load;
            teamDailyMap[di][tl.team] = (teamDailyMap[di][tl.team] || 0) + load;
          }
          const pi = projectIndexById.get(f.project);
          if (pi !== undefined) {
            projectDaily[di][pi] += load;
            projectDailyMap[di][f.project] = (projectDailyMap[di][f.project] || 0) + load;
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
      totalOrgDaily
    };
  }

  // Apply deltas for changed features (subtract old contribution, add new)
  _applyFeatureDeltas(changedIds, effectiveById, ctx) {
    const {
      selectedProjects,
      selectedTeams,
      selectedStates,
      teams,
      projects,
      teamIndexById,
      projectIndexById,
      dates
    } = ctx;

    const cache = this._lastResultCache;
    if (!cache) return;

    const dateIndex = this._dateIndexMap;
    const teamDaily = cache.teamDaily;
    const projectDaily = cache.projectDaily;
    const teamDailyMap = cache.teamDailyMap;
    const projectDailyMap = cache.projectDailyMap;
    const totalOrgDaily = cache.totalOrgDaily;

    const selectedProjectSet = new Set(selectedProjects);
    const selectedTeamSet = new Set(selectedTeams);
    const selectedStateSet = new Set(selectedStates);

    for (const id of changedIds) {
      const oldF = this._lastFeaturesById.get(id) || null;
      const newF = effectiveById.get(id) || null;

      const processFeature = (f, sign) => {
        if (!f || !f.start || !f.end) return;
        if (!selectedProjectSet.has(f.project)) return;
        const fState = f.status || f.state;
        if (!selectedStateSet.has(fState)) return;

        if (f.type === 'epic') {
          const childIds = this.childrenByEpic.get(f.id) || [];
          if (!isEnabled('USE_EPIC_CAPACITY_GAP_FILLS') && childIds.length) return;
        }

        const startIdx = dateIndex.get(f.start);
        const endIdx = dateIndex.get(f.end);
        if (startIdx === undefined || endIdx === undefined) return;

        const tls = f.capacity || [];
        for (let di = startIdx; di <= endIdx; di++) {
          if (f.type === 'epic' && isEnabled('USE_EPIC_CAPACITY_GAP_FILLS')) {
            const childIds = this.childrenByEpic.get(f.id) || [];
            if (childIds.length) {
              let childCovers = false;
              for (const cid of childIds) {
                const ch = this._lastFeaturesById.get(cid) || effectiveById.get(cid);
                if (!ch || !ch.start || !ch.end) continue;
                if (dates[di] >= ch.start && dates[di] <= ch.end) { childCovers = true; break; }
              }
              if (childCovers) continue;
            }
          }

          let projectLoadForDay = 0;
          for (const tl of tls) {
            if (!selectedTeamSet.has(tl.team)) continue;
            const ti = teamIndexById.get(tl.team);
            const load = Number(tl.capacity) || 0;
            if (ti !== undefined) {
              teamDaily[di][ti] += sign * load;
              teamDailyMap[di][tl.team] = (teamDailyMap[di][tl.team] || 0) + (sign * load);
            }
            const pi = projectIndexById.get(f.project);
            if (pi !== undefined) {
              projectDaily[di][pi] += sign * load;
              projectDailyMap[di][f.project] = (projectDailyMap[di][f.project] || 0) + (sign * load);
              projectLoadForDay += load;
            }
          }
          totalOrgDaily[di] += sign * projectLoadForDay;
        }
      };

      // subtract old then add new
      if (oldF) processFeature(oldF, -1);
      if (newF) processFeature(newF, +1);

      // update stored feature snapshot (deep copy capacity array to avoid reference issues)
      if (newF) {
        const snapshot = { ...newF };
        if (Array.isArray(newF.capacity)) {
          snapshot.capacity = newF.capacity.map(c => ({ ...c }));
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
      totalOrgDailyPerTeamAvg: []
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
    const cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
    const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
    
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
    selectedTeams,
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
    const selectedTeamSet = new Set(selectedTeams);
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
        const fState = f.status || f.state;
        if (!selectedStateSet.has(fState)) continue;
        
        // Handle epic capacity based on mode
        if (f.type === 'epic') {
          if (!isEnabled('USE_EPIC_CAPACITY_GAP_FILLS')) {
            const childIds = this.childrenByEpic.get(f.id) || [];
            if (childIds.length) continue; // Skip epic if has children
          } else if (isEnabled('USE_EPIC_CAPACITY_GAP_FILLS')) {
            const childIds = this.childrenByEpic.get(f.id) || [];
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
          // Filter by selected teams
          if (!selectedTeamSet.has(tl.team)) continue;
          
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
      totalOrgDaily
    };
  }
}
