import { html } from '../vendor/lit.js';
import {
  buildTaskTree,
  buildCostTaskRows,
  monthKey,
} from './PluginCostCalculator.js';
import { sel } from '../application/imports.js';
import { getIconTemplate } from '../services/IconService.js';
import { renderCountingBanner, renderClipBanner } from './PluginCostShared.js';

export function renderEstimateComparison(row) {
  if (!row.hasOwnAllocation) return row.feature.capacity.length > 0 ? 'No dated allocation' : 'No own allocation';
  if (!row.hasOwnEstimate) return 'Unpriced allocation';
  if (row.comparisons.length === 0) return '';
  return html`${row.comparisons.map((comparison) => {
    const percent = comparison.percent;
    const matched = percent !== null && Math.abs(percent) < 0.05;
    const direction = percent !== null && percent > 0 ? 'Overrun' : 'Underrun';
    const label = percent === null ? 'Unpriced estimate' : matched ? 'Matches estimate'
      : `${direction} ${Math.abs(percent).toFixed(1)}%`;
    const title = `Own cost: ${comparison.estimate.cost.toFixed(2)}; breakdown cost: ${comparison.breakdown.cost.toFixed(2)}; own hours: ${comparison.estimate.hours.toFixed(2)}; breakdown hours: ${comparison.breakdown.hours.toFixed(2)}`;
    return html`<div class="estimate-comparison ${matched ? '' : 'estimate-deviation'}" title="${title}">
      ${comparison.team}: ${label}
    </div>`;
  })}`;
}

export function renderTaskView(component) {
  if (!component.data || !component.data.projects) {
    return html`
      <div class="empty-state">
        <h3>No Task Data</h3>
        <p>No cost data available. Please ensure projects and teams are selected.</p>
      </div>
    `;
  }

  const selectedProjects = sel.selection.getSelectedProjects();
  if (selectedProjects.length === 0) {
    return html`
      <div class="empty-state">
        <h3>No Selection</h3>
        <p>Please select projects (Top menu → Plan) to view task costs.</p>
      </div>
    `;
  }

  const selectedProjectIds = new Set(selectedProjects.map((p) => String(p.id)));

  const allFeatures = Object.values(component.data.projects || {})
    .flatMap((p) => p.features || [])
    .filter((f) => selectedProjectIds.has(String(f.project)));

  // Use tasks from the selected plans regardless of team selection
  const filteredFeatures = allFeatures.slice();

  if (filteredFeatures.length === 0) {
    return html`
      <div class="empty-state">
        <h3>No Tasks Found</h3>
        <p>No tasks found matching the selected projects and teams.</p>
      </div>
    `;
  }

  // Group features by project id so we can render per-project sections
  const featuresByProject = new Map();
  for (const f of allFeatures) {
    const pid = String(f.project);
    if (!featuresByProject.has(pid)) featuresByProject.set(pid, []);
    featuresByProject.get(pid).push(f);
  }

  // Ensure expandedSections exists and default to expanded for each project
  if (!component._expandedSections)
    component._expandedSections = new Set(
      Array.from(featuresByProject.keys()).map((k) => `project-${k}`)
    );

  return html`
    <div>
      ${renderCountingBanner()}
      ${renderClipBanner(allFeatures, component.startDate, component.endDate)}
      ${selectedProjects.map((project) => {
        const key = `project-${String(project.id)}`;
        const isExpanded = component._expandedSections.has(key);
        const projectFeatures = featuresByProject.get(String(project.id)) || [];
        return html`
          <div style="margin-bottom:20px;">
            <div
              class="project-header expandable"
              @click="${() => {
                if (!component._expandedSections) component._expandedSections = new Set();
                if (component._expandedSections.has(key))
                  component._expandedSections.delete(key);
                else component._expandedSections.add(key);
                component.requestUpdate();
              }}"
            >
              <span class="expand-icon ${isExpanded ? 'expanded' : ''}">▶</span>
              ${project.name}
            </div>
            ${isExpanded ?
              html`<div style="margin-left:12px; margin-top:8px;">
                ${renderTasksInProjectTable(component, projectFeatures)}
              </div>`
            : ''}
          </div>
        `;
      })}
    </div>
  `;
}

function renderTasksInProjectTable(component, features) {
  if (!features || features.length === 0) {
    return html`<div style="color:#666; font-size:13px; margin-bottom:12px;">
      No tasks available for the selected projects.
    </div>`;
  }

  const monthKeys = component.months.map((m) => monthKey(m));

  // Build hierarchy for DFS pre-order display and hierarchy-aware rollup
  const { childrenMap } = buildTaskTree(
    features,
    sel.feature.getChildrenByParentMap()
  );
  const rows = buildCostTaskRows(features, childrenMap, monthKeys,
    { start: component.startDate, end: component.endDate });

  // Resolve team id/slug to friendly name using component.costTeams (built once)
  const costTeamsList =
    component && component.costTeams ?
      Array.isArray(component.costTeams.teams) ? component.costTeams.teams
      : Array.isArray(component.costTeams) ? component.costTeams
      : []
    : [];
  const teamNameByKey = {};
  for (const tt of costTeamsList) {
    if (tt.id != null) teamNameByKey[String(tt.id)] = tt.name || tt.id;
    if (tt.slug) teamNameByKey[String(tt.slug)] = tt.name || tt.slug;
    if (tt.name) teamNameByKey[String(tt.name)] = tt.name;
  }

  const formatValue = (n) => {
    const v = typeof n === 'number' ? n : Number(n || 0);
    if (v === 0) return '';
    return String(Math.round(v));
  };

  return html`
    <table>
      <thead>
        <tr>
          <th style="width:36px;"></th>
          <th>Task</th>
          <th class="numeric">Start</th>
          <th class="numeric">End</th>
          <th>Teams</th>
          <th class="numeric">Cost</th>
          <th class="numeric">Hours</th>
          <th class="numeric">Own Estimate</th>
          <th class="numeric">Own Hours</th>
          <th>Estimate vs Breakdown</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => {
          const { feature, depth, totalCost, totalHours } = row;

          const teams =
            Array.isArray(feature.capacity) ?
              feature.capacity.map((c) => String(c.team)).filter(Boolean)
            : [];
          const teamsLabel = teams.map((t) => teamNameByKey[t] || t).join(', ');

          // Clip detection: flag features whose dates extend outside the display window
          const featureStart = feature.start ? String(feature.start).slice(0, 10) : null;
          const featureEnd = feature.end ? String(feature.end).slice(0, 10) : null;
          const headClipped =
            featureStart && component.startDate && featureStart < component.startDate;
          const tailClipped =
            featureEnd && component.endDate && featureEnd > component.endDate;

          const ft = (feature.type || '').toString().toLowerCase();
          const iconTemplate = getIconTemplate(ft);

          return html`
            <tr class="${feature.displayMode === 'context' ? 'context-row' : ''}">
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
                ${feature.displayMode === 'context' ? html`<span class="context-label">Context</span>` : ''}
              </td>
              <td class="numeric">${feature.start || ''}</td>
              <td class="numeric">${feature.end || ''}</td>
              <td>${teamsLabel}</td>
              <td class="numeric">${formatValue(totalCost)}</td>
              <td class="numeric">${formatValue(totalHours)}</td>
              <td class="numeric">${formatValue(row.ownCost)}</td>
              <td class="numeric">${formatValue(row.ownHours)}</td>
              <td>${renderEstimateComparison(row)}</td>
            </tr>
          `;
        })}
      </tbody>
    </table>
  `;
}
