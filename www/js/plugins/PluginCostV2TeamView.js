import { html } from '../vendor/lit.js';
import { monthLabel, monthKey, buildTaskTree, buildByTeam, flattenTree } from './PluginCostV2Calculator.js';
import { state } from '../services/State.js';
import { getIconTemplate } from '../services/IconService.js';
import { renderCountingBanner, renderClipBanner } from './PluginCostV2Shared.js';

export function renderTeamView(component) {
  if (!component.data || !component.data.projects) {
    return html`
      <div class="empty-state">
        <h3>No Team Data</h3>
        <p>No cost data available. Please ensure projects and teams are selected.</p>
      </div>
    `;
  }

  const selectedTeams = (state.teams || []).filter((t) => t.selected);
  if (selectedTeams.length === 0) {
    return html`
      <div class="empty-state">
        <h3>No Teams Selected</h3>
        <p>Please select one or more teams from the Top menu → Team.</p>
      </div>
    `;
  }

  const monthKeys = component.months.map((m) => monthKey(m));

  // Collect all unique features across projects for the clip banner
  const allFeatures = Object.values(component.data.projects || {}).flatMap(
    (p) => p.features || []
  );

  // Ensure expandedTeams set exists on component; default to expanded
  if (!component._expandedTeams)
    component._expandedTeams = new Set(selectedTeams.map((t) => `team-${t.id}`));

  return html`
    <div>
      ${renderCountingBanner()}
      ${renderClipBanner(allFeatures, component.startDate, component.endDate)}
      ${selectedTeams.map((team) => renderTeamTable(component, team, monthKeys))}
    </div>
  `;
}

function renderTeamTable(component, team, monthKeys) {
  const teamId = String(team.id);
  // Collect all features from projects and deduplicate by feature id
  const rawFeatures = Object.values(component.data.projects || {}).flatMap(
    (p) => p.features || []
  );

  // Deduplicate by feature id. When the same feature appears under multiple
  // projects (e.g., selected plan + its parent), merge `capacity` entries so
  // team allocations reflect the union of reported capacities. For safety we
  // take the max capacity per team when conflicts exist.
  const featureById = new Map();
  for (const f of rawFeatures) {
    if (!f || f.id == null) continue;
    const key = String(f.id);
    const incomingCap = Array.isArray(f.capacity) ? f.capacity : [];
    if (!featureById.has(key)) {
      // clone to avoid mutating original objects
      featureById.set(key, Object.assign({}, f, { capacity: incomingCap.slice() }));
      continue;
    }

    // Merge capacities: prefer the maximum capacity for each team
    const existing = featureById.get(key);
    const existingCap = Array.isArray(existing.capacity) ? existing.capacity : [];
    const capMap = new Map();
    for (const c of existingCap) {
      if (c && c.team != null) capMap.set(String(c.team), Number(c.capacity) || 0);
    }
    for (const c of incomingCap) {
      if (c && c.team != null) {
        const t = String(c.team);
        const val = Number(c.capacity) || 0;
        const prev = capMap.get(t) || 0;
        capMap.set(t, Math.max(prev, val));
      }
    }
    // Rebuild merged capacity array
    const merged = [];
    for (const [team, cap] of capMap.entries())
      merged.push({ team: team, capacity: cap });
    existing.capacity = merged;
  }
  const allFeatures = Array.from(featureById.values());

  // Build full hierarchy: childrenMap for buildByTeam, parentMap for root detection
  const { childrenMap, parentMap } = buildTaskTree(
    allFeatures,
    state.childrenByParent || new Map()
  );

  // Hierarchy-aware, window-restricted per-team rollup across all features
  const byTeam = buildByTeam(allFeatures, childrenMap, monthKeys);

  // Filter to features assigned to this team (capacity-based, same as before)
  const teamFeaturesRaw = allFeatures.filter(
    (f) =>
      f.capacity &&
      f.capacity.some((c) => String(c.team) === teamId && Number(c.capacity) > 0)
  );

  // Additional dedupe: if multiple features share the same title and project,
  // treat them as duplicates (helps when backend returns near-duplicates).
  const seenTitleProject = new Set();
  const teamFeatures = [];
  for (const f of teamFeaturesRaw) {
    const title = (f.title || f.name || '').toString().trim().toLowerCase();
    const proj = Object.values(component.data.projects || {}).find((p) =>
      (p.features || []).some((ff) => String(ff.id) === String(f.id))
    );
    const projectName = proj ? proj.name : f.project || '';
    const dedupKey = title ? `${title}::${projectName}` : `id::${String(f.id)}`;
    if (seenTitleProject.has(dedupKey)) continue;
    seenTitleProject.add(dedupKey);
    teamFeatures.push(f);
  }

  // Build DFS-ordered display list (parents precede their children)
  const teamFeatureSet = new Set(teamFeatures.map((f) => String(f.id)));
  const teamChildrenMap = new Map();
  for (const f of teamFeatures) {
    const fid = String(f.id);
    const children = (childrenMap.get(fid) || []).filter((cid) => teamFeatureSet.has(cid));
    if (children.length > 0) teamChildrenMap.set(fid, children);
  }
  const teamRootIds = teamFeatures
    .filter((f) => {
      const pid = parentMap.get(String(f.id));
      return !pid || !teamFeatureSet.has(pid);
    })
    .map((f) => String(f.id));
  const teamFeatureMap = new Map(teamFeatures.map((f) => [String(f.id), f]));
  const orderedTeamFeatures = flattenTree(teamRootIds, teamChildrenMap, teamFeatureMap, 0, []);

  const key = `team-${String(team.id)}`;
  const isExpanded = component._expandedTeams && component._expandedTeams.has(key);

  if (teamFeatures.length === 0) {
    return html`
      <div style="margin-bottom:32px;">
        <div
          class="team-header expandable"
          @click="${() => {
            if (!component._expandedTeams) component._expandedTeams = new Set();
            if (component._expandedTeams.has(key)) component._expandedTeams.delete(key);
            else component._expandedTeams.add(key);
            component.requestUpdate();
          }}"
        >
          <span class="expand-icon ${isExpanded ? 'expanded' : ''}">▶</span>
          ${team.name}
        </div>
        ${isExpanded ?
          html`<p style="color:#999; font-size:13px; margin:8px 0;">
            No features allocated to this team.
          </p>`
        : ''}
      </div>
    `;
  }

  const formatValue = (val) => {
    const n = typeof val === 'number' ? val : Number(val || 0);
    if (n === 0) return '';
    if (component.viewMode === 'hours') {
      return Math.round(n).toString();
    }
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };

  // Build per-feature allocations from the hierarchy-aware buildByTeam result
  const featureAllocations = orderedTeamFeatures
    .map(({ feature, depth }) => {
      const featureTeams = byTeam.get(String(feature.id));
      const alloc = featureTeams?.get(teamId);
      if (!alloc) return null;
      return { feature, depth, allocation: alloc };
    })
    .filter((x) => x !== null);

  // Team totals: sum only root contributors to avoid double-counting parent + children
  const teamTotals = {
    cost: { internal: new Map(), external: new Map() },
    hours: { internal: new Map(), external: new Map() },
    totalCost: 0,
    totalHours: 0,
  };
  for (const rootId of teamRootIds) {
    const featureTeams = byTeam.get(rootId);
    const alloc = featureTeams?.get(teamId);
    if (!alloc) continue;
    for (const mKey of monthKeys) {
      const ci = alloc.cost.internal.get(mKey) || 0;
      const ce = alloc.cost.external.get(mKey) || 0;
      const hi = alloc.hours.internal.get(mKey) || 0;
      const he = alloc.hours.external.get(mKey) || 0;
      teamTotals.cost.internal.set(mKey, (teamTotals.cost.internal.get(mKey) || 0) + ci);
      teamTotals.cost.external.set(mKey, (teamTotals.cost.external.get(mKey) || 0) + ce);
      teamTotals.hours.internal.set(mKey, (teamTotals.hours.internal.get(mKey) || 0) + hi);
      teamTotals.hours.external.set(mKey, (teamTotals.hours.external.get(mKey) || 0) + he);
      teamTotals.totalCost += ci + ce;
      teamTotals.totalHours += hi + he;
    }
  }

  return html`
    <div style="margin-bottom:32px;">
      <div
        class="team-header expandable"
        @click="${() => {
          if (!component._expandedTeams) component._expandedTeams = new Set();
          if (component._expandedTeams.has(key)) component._expandedTeams.delete(key);
          else component._expandedTeams.add(key);
          component.requestUpdate();
        }}"
      >
        <span class="expand-icon ${isExpanded ? 'expanded' : ''}">▶</span>
        ${team.name} (${teamFeatures.length} features)
      </div>

      ${isExpanded ?
        html`<table>
          <thead>
            <tr>
              <th style="width:36px;"></th>
              <th>Feature</th>
              <th>Project</th>
              ${component.months.map(
                (m) => html`<th class="numeric" colspan="2">${monthLabel(m)}</th>`
              )}
              <th class="numeric">Sum</th>
            </tr>
            <tr>
              <th></th>
              <th></th>
              <th></th>
              ${component.months.map(
                () =>
                  html`<th class="numeric">Int</th>
                    <th class="numeric">Ext</th>`
              )}
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${featureAllocations.map(({ feature, depth, allocation }) => {
              const dataMap =
                component.viewMode === 'cost' ? allocation.cost : allocation.hours;
              // Window-restricted total (maps already keyed to monthKeys only)
              let total = 0;
              for (const mKey of monthKeys) {
                total +=
                  (dataMap.internal.get(mKey) || 0) + (dataMap.external.get(mKey) || 0);
              }

              const projectData = Object.values(component.data.projects || {}).find((p) =>
                (p.features || []).some((f) => String(f.id) === String(feature.id))
              );
              const projectName = projectData ? projectData.name : feature.project || '-';

              // Clip detection
              const featureStart = feature.start ? String(feature.start).slice(0, 10) : null;
              const featureEnd = feature.end ? String(feature.end).slice(0, 10) : null;
              const headClipped =
                featureStart && component.startDate && featureStart < component.startDate;
              const tailClipped =
                featureEnd && component.endDate && featureEnd > component.endDate;

              const ft = (feature.type || '').toString().toLowerCase();
              const iconTemplate = getIconTemplate(ft);

              return html`
                <tr>
                  <td style="text-align:center; white-space:nowrap;">
                    ${headClipped ?
                      html`<span class="clip-warning" title="Starts ${featureStart} — before display window">◀</span>`
                    : ''}
                    <span class="type-icon ${ft}" title="${feature.type || 'Task'}">${iconTemplate}</span>
                    ${tailClipped ?
                      html`<span class="clip-warning" title="Ends ${featureEnd} — after display window">▶</span>`
                    : ''}
                  </td>
                  <td style="padding-left:${8 + depth * 20}px;">
                    ${feature.title || feature.name || feature.id}
                  </td>
                  <td style="font-size:11px; color:#666;">${projectName}</td>
                  ${monthKeys.map((mKey) => {
                    const intVal = dataMap.internal.get(mKey) || 0;
                    const extVal = dataMap.external.get(mKey) || 0;
                    return html`
                      <td class="numeric">${formatValue(intVal)}</td>
                      <td class="numeric">${formatValue(extVal)}</td>
                    `;
                  })}
                  <td class="numeric sum-column">${formatValue(total)}</td>
                </tr>
              `;
            })}
            <tr class="totals-row">
              <td colspan="3"><strong>Team Total</strong></td>
              ${monthKeys.map((mKey) => {
                const dataMap =
                  component.viewMode === 'cost' ? teamTotals.cost : teamTotals.hours;
                const intVal = dataMap.internal.get(mKey) || 0;
                const extVal = dataMap.external.get(mKey) || 0;
                return html`
                  <td class="numeric">
                    <strong>${formatValue(intVal)}</strong>
                  </td>
                  <td class="numeric">
                    <strong>${formatValue(extVal)}</strong>
                  </td>
                `;
              })}
              <td class="numeric sum-column">
                <strong
                  >${formatValue(
                    component.viewMode === 'cost' ?
                      teamTotals.totalCost
                    : teamTotals.totalHours
                  )}</strong
                >
              </td>
            </tr>
          </tbody>
        </table>`
      : ''}
    </div>
  `;
}
