import { expandGroupAllocations, resolveEffectiveAllocations } from './allocationRule.js';

export function projectVirtualAllocations({ features, visibleFeatures, teams, selectedTeamIds, isEligible }) {
  const entries = visibleFeatures.map((feature) => ({
    kind: 'task', sourceId: String(feature.id), feature,
  }));
  if (selectedTeamIds.size === 0) return entries;
  const groups = teams.filter((team) => team.kind === 'group');
  const groupIds = groups.map((group) => String(group.id));
  const memberships = new Map(teams.filter((team) => groupIds.includes(String(team.group_id)))
    .map((team) => [String(team.id), String(team.group_id)]));
  const focusIds = new Set(selectedTeamIds);
  for (const [teamId, groupId] of memberships) {
    if (selectedTeamIds.has(groupId)) focusIds.add(teamId);
  }
  const effective = expandGroupAllocations(
    resolveEffectiveAllocations(features, undefined, memberships), memberships, groupIds,
  );
  const visibleIds = new Set(entries.map((entry) => entry.sourceId));
  for (const feature of features) {
    const sourceId = String(feature.id);
    if (visibleIds.has(sourceId) || !isEligible(feature)) continue;
    const allocations = effective.get(sourceId).filter((entry) => focusIds.has(String(entry.team)));
    if (allocations.length > 0) entries.push({ kind: 'virtual', sourceId, feature, allocations });
  }
  return entries;
}