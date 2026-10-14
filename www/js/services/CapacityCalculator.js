import { CapacityEvents } from '../core/EventRegistry.js';
import { getPlanAncestorIds, resolveFundedTargetProject } from '../application/shared/ownership.js';
import { featureMatchesPlans } from '../application/shared/featureProjection.js';
import {
  expandGroupAllocations, hasValidAllocationSpan, resolveEffectiveAllocations,
} from '../application/shared/allocationRule.js';

// Special project ID for unfunded/orphaned allocations
const UNFUNDED_PROJECT_ID = '__unfunded__';

export class CapacityCalculator {
  constructor(eventBus) {
    this.bus = eventBus;
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
  * that don't roll up to any higher-level container. Consumers should check for
   * '__unfunded__' in projectDailyCapacityMap or at the last index in projectDailyCapacity tuples.
   */
  calculate(features, filters, teams, projects) {
    const { selectedProjects = [], selectedStates = [] } = filters;

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

    const groups = teams.filter((team) => team.kind === 'group');
    const members = teams.filter((team) => team.kind !== 'group');
    if (members.length === 0) return this._emptyResult();
    const groupIds = groups.map((group) => group.id);
    const memberships = new Map(members.filter((team) => groupIds.includes(team.group_id))
      .map((team) => [team.id, team.group_id]));
    const allocations = expandGroupAllocations(
      resolveEffectiveAllocations(features, undefined, memberships), memberships, groupIds,
    );
    // Generate date range
    const dates = this._generateDateRange(features);
    if (dates.length === 0) {
      return this._emptyResult();
    }

    // Add synthetic unfunded project and include in calculations
    const unfundedProject = {
      id: UNFUNDED_PROJECT_ID,
      type: projects[0].container_types[0],
      container_order: 0,
      container_types: projects[0].container_types,
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
    const effectiveById = new Map(features.map((feature) => [String(feature.id), feature]));

    // Full calculation (feature-first) for best average performance
    const { teamDaily, teamDailyMap, projectDaily, projectDailyMap, planDailyMap,
      planTeamDailyMap, totalOrgDaily } =
      this._calculateDailyCapacities_FeatureFirst(
        features,
        dates,
        selectedProjects,
        selectedStates,
        teams,
        teamIndexById,
        projectIndexById,
        projectById,
        effectiveById,
        allocations
      );

    // The full organization roster establishes a stable denominator.
    const nOrganizationTeams = members.length;
    const projectDailyNormalized = projectDaily.map((tuple) =>
      tuple.map((v) => v / nOrganizationTeams)
    );
    const totalOrgDailyPerTeamAvg = totalOrgDaily.map((v) => v / nOrganizationTeams);
    for (const group of groups) {
      const memberIndices = members.filter((team) => team.group_id === group.id)
        .map((team) => teamIndexById.get(team.id));
      const groupIndex = teamIndexById.get(group.id);
      for (let index = 0; index < dates.length; index++) {
        const load = memberIndices.length === 0 ? 0
          : memberIndices.reduce((total, member) => total + teamDaily[index][member], 0)
            / memberIndices.length;
        teamDaily[index][groupIndex] = load;
        teamDailyMap[index][group.id] = load;
      }
    }

    const result = {
      dates,
      teamDailyCapacity: teamDaily,
      teamDailyCapacityMap: teamDailyMap,
      projectDailyCapacityRaw: projectDaily,
      projectDailyCapacity: projectDailyNormalized,
      projectDailyCapacityMap: projectDailyMap,
      planDailyCapacityMap: planDailyMap,
      planTeamDailyCapacityMap: planTeamDailyMap,
      totalOrgDailyCapacity: totalOrgDaily,
      totalOrgDailyPerTeamAvg,
    };

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
    effectiveById,
    allocations
  ) {
    const dlen = dates.length;
    const tlen = teams.length;
    const plen = projectIndexById.size;

    const teamDaily = Array.from({ length: dlen }, () => new Array(tlen).fill(0));
    const teamDailyMap = Array.from({ length: dlen }, () => ({}));
    const projectDaily = Array.from({ length: dlen }, () => new Array(plen).fill(0));
    const projectDailyMap = Array.from({ length: dlen }, () => ({}));
    const planDailyMap = Array.from({ length: dlen }, () => ({}));
    const planTeamDailyMap = Array.from({ length: dlen }, () => ({}));
    const totalOrgDaily = new Array(dlen).fill(0);

    const selectedProjectSet = new Set(selectedProjects.map(String));
    const selectedStateSet = new Set(selectedStates);
    const fundedTargetMemo = new Map();

    const dateIndex = new Map(dates.map((date, index) => [date, index]));

    for (const f of features) {
      if (!f || !f.start || !f.end) continue;
      if (f.ancestorOnly === true) continue;
      if (!featureMatchesPlans(f, selectedProjectSet)) continue;
      const fState = f.state;
      if (!selectedStateSet.has(fState)) continue;

      const startIdx = dateIndex.get(f.start);
      const endIdx = dateIndex.get(f.end);
      if (startIdx === undefined || endIdx === undefined) continue;

      const tls = allocations.get(String(f.id));
      if (tls.length === 0) continue;
      const ancestorPlanIds = getPlanAncestorIds(f, effectiveById, projectById);
      const fundedProjectId = resolveFundedTargetProject(
        f, effectiveById, projectById, fundedTargetMemo,
      );
      const targetProjectId = fundedProjectId === null ? UNFUNDED_PROJECT_ID : fundedProjectId;
      const pi = projectIndexById.get(targetProjectId);
      for (let di = startIdx; di <= endIdx; di++) {
        let projectLoadForDay = 0;
        for (const tl of tls) {
          const ti = teamIndexById.get(tl.team);
          const load = Number(tl.capacity);
          for (const planId of ancestorPlanIds) {
            if (planDailyMap[di][planId] === undefined) planDailyMap[di][planId] = 0;
            planDailyMap[di][planId] += load;
            if (!planTeamDailyMap[di][planId]) planTeamDailyMap[di][planId] = {};
            const teamLoads = planTeamDailyMap[di][planId];
            if (teamLoads[tl.team] === undefined) teamLoads[tl.team] = 0;
            teamLoads[tl.team] += load;
          }
          if (ti !== undefined) {
            teamDaily[di][ti] += load;
            teamDailyMap[di][tl.team] = teamDaily[di][ti];
          }
          if (pi !== undefined) {
            projectDaily[di][pi] += load;
            projectDailyMap[di][targetProjectId] = projectDaily[di][pi];
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
      planDailyMap,
      planTeamDailyMap,
      totalOrgDaily,
    };
  }

  _emptyResult() {
    return {
      dates: [],
      teamDailyCapacity: [],
      teamDailyCapacityMap: [],
      projectDailyCapacityRaw: [],
      projectDailyCapacity: [],
      projectDailyCapacityMap: [],
      planDailyCapacityMap: [],
      planTeamDailyCapacityMap: [],
      totalOrgDailyCapacity: [],
      totalOrgDailyPerTeamAvg: [],
    };
  }

  _generateDateRange(features) {
    if (features.length === 0) return [];

    let minStart = null;
    let maxEnd = null;

    for (const f of features) {
      if (!hasValidAllocationSpan(f)) continue;
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

}
