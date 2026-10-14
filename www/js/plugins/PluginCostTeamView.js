import { html } from '../vendor/lit.js';
import { monthLabel, monthKey, buildTaskTree, buildByTeam, flattenTree } from './PluginCostCalculator.js';
import { sel } from '../application/imports.js';
import { getIconTemplate } from '../services/IconService.js';
import { renderCountingBanner, renderClipBanner } from './PluginCostShared.js';

export function renderTeamView(component) {
  if (!component.data || !component.data.projects) {
    return html`
      <div class="empty-state">
        <h3>No Team Data</h3>
        <p>No cost data available. Please ensure projects and teams are selected.</p>
      </div>
    `;
  }

  const selectedTeams = sel.selection.getSelectedTeams();
  if (selectedTeams.length === 0) {
    return html`
      <div class="empty-state">
        <h3>No Teams Selected</h3>
        <p>Please select one or more teams from Sidebar Team Drill-down.</p>
      </div>
    `;
  }

  const monthKeys = component.months.map((m) => monthKey(m));

  // Collect all unique features across projects for the clip banner
  const allFeatures = Object.values(component.data.projects).flatMap(
    (project) => project.features
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
  const rawFeatures = Object.values(component.data.projects).flatMap(
    (project) => project.features
  );

  const featureById = new Map();
  for (const feature of rawFeatures) {
    const id = String(feature.id);
    if (!featureById.has(id)) featureById.set(id, feature);
  }
  const allFeatures = Array.from(featureById.values());

  // Build full hierarchy: childrenMap for buildByTeam, parentMap for root detection
  const { childrenMap, parentMap } = buildTaskTree(
    allFeatures,
    sel.feature.getChildrenByParentMap()
  );

  // Hierarchy-aware, window-restricted per-team rollup across all features
  const byTeam = buildByTeam(allFeatures, childrenMap, monthKeys);
  if (team.kind === 'group') {
    const memberIds = component.costTeams.catalogue
      .filter((record) => record.kind === 'team' && record.group_id === teamId)
      .map((record) => record.id);
    for (const featureTeams of byTeam.values()) {
      const group = { cost: { internal: new Map(), external: new Map() },
        hours: { internal: new Map(), external: new Map() } };
      let matched = false;
      for (const memberId of memberIds) {
        if (!featureTeams.has(memberId)) continue;
        matched = true;
        const member = featureTeams.get(memberId);
        for (const metric of ['cost', 'hours']) {
          for (const account of ['internal', 'external']) {
            const target = group[metric][account];
            for (const [month, value] of member[metric][account]) {
              target.set(month, (target.has(month) ? target.get(month) : 0) + value);
            }
          }
        }
      }
      if (matched) featureTeams.set(teamId, group);
    }
  }

  const teamFeatures = allFeatures.filter((feature) => byTeam.get(String(feature.id)).has(teamId));

  // Build DFS-ordered display list (parents precede their children)
  const teamFeatureSet = new Set(teamFeatures.map((f) => String(f.id)));
  const teamChildrenMap = new Map();
  for (const [featureId, childIds] of childrenMap) {
    if (!teamFeatureSet.has(featureId)) continue;
    const children = childIds.filter((childId) => teamFeatureSet.has(childId));
    if (children.length > 0) teamChildrenMap.set(featureId, children);
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

  const amount = (series, month) => series.has(month) ? series.get(month) : 0;
  const formatValue = (value) => {
    if (value === 0) return '';
    if (component.viewMode === 'hours') {
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };

  // Build per-feature allocations from the hierarchy-aware buildByTeam result
  const featureAllocations = orderedTeamFeatures
    .map(({ feature, depth }) => {
      const featureTeams = byTeam.get(String(feature.id));
      const alloc = featureTeams.get(teamId);
      if (!alloc) return null;
      return { feature, depth, allocation: alloc };
    })
    .filter((x) => x !== null);

  // Team totals: sum only root contributors to avoid double-counting parent + children
  const teamTotals = {
    cost: { internal: new Map(), external: new Map() },
    hours: { internal: new Map(), external: new Map() },
  };
  for (const rootId of teamRootIds) {
    const featureTeams = byTeam.get(rootId);
    const alloc = featureTeams.get(teamId);
    if (!alloc) continue;
    for (const mKey of monthKeys) {
      for (const metric of ['cost', 'hours']) {
        for (const account of ['internal', 'external']) {
          const target = teamTotals[metric][account];
          target.set(mKey, amount(target, mKey) + amount(alloc[metric][account], mKey));
        }
      }
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
              <th class="numeric" colspan="2">Period Totals</th>
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
              <th class="numeric">Int</th>
              <th class="numeric">Ext</th>
            </tr>
          </thead>
          <tbody>
            ${featureAllocations.map(({ feature, depth, allocation }) => {
              const dataMap =
                component.viewMode === 'cost' ? allocation.cost : allocation.hours;
              // Window-restricted total (maps already keyed to monthKeys only)
              let internalTotal = 0;
              let externalTotal = 0;
              for (const mKey of monthKeys) {
                internalTotal += amount(dataMap.internal, mKey);
                externalTotal += amount(dataMap.external, mKey);
              }

              const projectData = Object.values(component.data.projects).find((project) =>
                project.features.some((projectFeature) => String(projectFeature.id) === String(feature.id))
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
                    const intVal = amount(dataMap.internal, mKey);
                    const extVal = amount(dataMap.external, mKey);
                    return html`
                      <td class="numeric">${formatValue(intVal)}</td>
                      <td class="numeric">${formatValue(extVal)}</td>
                    `;
                  })}
                  <td class="numeric sum-column">${formatValue(internalTotal)}</td>
                  <td class="numeric sum-column">${formatValue(externalTotal)}</td>
                </tr>
              `;
            })}
            <tr class="totals-row">
              <td colspan="3"><strong>Team Total</strong></td>
              ${monthKeys.map((mKey) => {
                const dataMap =
                  component.viewMode === 'cost' ? teamTotals.cost : teamTotals.hours;
                const intVal = amount(dataMap.internal, mKey);
                const extVal = amount(dataMap.external, mKey);
                return html`
                  <td class="numeric">
                    <strong>${formatValue(intVal)}</strong>
                  </td>
                  <td class="numeric">
                    <strong>${formatValue(extVal)}</strong>
                  </td>
                `;
              })}
              ${['internal', 'external'].map((account) => html`<td class="numeric sum-column">
                <strong>${formatValue(monthKeys.reduce((total, month) => total + amount(
                  component.viewMode === 'cost' ? teamTotals.cost[account] : teamTotals.hours[account],
                  month), 0))}</strong>
              </td>`)}
            </tr>
          </tbody>
        </table>`
      : ''}
    </div>
  `;
}
