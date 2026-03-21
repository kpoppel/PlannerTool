import { html } from '../vendor/lit.js';
import { buildTaskTree, calculateBudgetDeviation, hasSignificantDeviation } from './PluginCostV2Calculator.js';
import { state } from '../services/State.js';
import { epicTemplate, featureTemplate } from '../services/IconService.js';

export function renderTaskView(component) {
  if (!component.data || !component.data.projects) {
    return html`
      <div class="empty-state">
        <h3>No Task Data</h3>
        <p>No cost data available. Please ensure projects and teams are selected.</p>
      </div>
    `;
  }

  const selectedProjects = (state.projects || []).filter(p => p.selected);
  if (selectedProjects.length === 0) {
    return html`
      <div class="empty-state">
        <h3>No Selection</h3>
        <p>Please select projects (Top menu → Plan) to view task costs.</p>
      </div>
    `;
  }

  const selectedProjectIds = new Set(selectedProjects.map(p => String(p.id)));

  const allFeatures = Object.values(component.data.projects || {})
    .flatMap(p => p.features || [])
    .filter(f => selectedProjectIds.has(String(f.project)));

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
  if (!component._expandedSections) component._expandedSections = new Set(Array.from(featuresByProject.keys()).map(k => `project-${k}`));

  return html`
    <div>
      ${selectedProjects.map(project => {
        const key = `project-${String(project.id)}`;
        const isExpanded = component._expandedSections.has(key);
        const projectFeatures = featuresByProject.get(String(project.id)) || [];
        return html`
          <div style="margin-bottom:20px;">
            <div class="project-header expandable" @click="${() => { if (!component._expandedSections) component._expandedSections = new Set(); if (component._expandedSections.has(key)) component._expandedSections.delete(key); else component._expandedSections.add(key); component.requestUpdate(); }}">
              <span class="expand-icon ${isExpanded ? 'expanded' : ''}">▶</span>
              ${project.name}
            </div>
            ${isExpanded ? html`<div style="margin-left:12px; margin-top:8px;">${renderTasksInProjectTable(component, projectFeatures)}</div>` : ''}
          </div>
        `;
      })}
    </div>
  `;
}

function renderTasksInProjectTable(component, features) {
  if (!features || features.length === 0) {
    return html`<div style="color:#666; font-size:13px; margin-bottom:12px;">No tasks available for the selected projects.</div>`;
  }

  const formatValue = (val) => {
    const n = typeof val === 'number' ? val : Number(val || 0);
    return String(Math.round(n));
  };

  // Build project name lookup
  const projects = component.data && component.data.projects ? component.data.projects : {};
  const projectNames = {};
  for (const pid of Object.keys(projects)) {
    try { projectNames[String(projects[pid].id)] = projects[pid].name; } catch (e) {}
  }

  return html`
    <table>
      <thead>
        <tr>
          <th style="width:36px;"></th>
          <th>Task</th>
          <th class="numeric">Start</th>
          <th class="numeric">End</th>
          <th class="numeric">Teams</th>
          <th class="numeric">Cost</th>
          <th class="numeric">Hours</th>
        </tr>
      </thead>
      <tbody>
        ${features.map(feature => {
          const metrics = feature && feature.metrics ? feature.metrics : null;
          let totalCost = 0;
          let totalHours = 0;
          if (metrics) {
            const c_internal = (metrics.internal && metrics.internal.cost) || (metrics.cost && metrics.cost.internal) || {};
            const c_external = (metrics.external && metrics.external.cost) || (metrics.cost && metrics.cost.external) || {};
            const h_internal = (metrics.internal && metrics.internal.hours) || (metrics.hours && metrics.hours.internal) || {};
            const h_external = (metrics.external && metrics.external.hours) || (metrics.hours && metrics.hours.external) || {};
            for (const v of Object.values(c_internal)) totalCost += Number(v || 0);
            for (const v of Object.values(c_external)) totalCost += Number(v || 0);
            for (const v of Object.values(h_internal)) totalHours += Number(v || 0);
            for (const v of Object.values(h_external)) totalHours += Number(v || 0);
          }

          const teams = Array.isArray(feature.capacity) ? feature.capacity.map(c => String(c.team)).filter(Boolean) : [];
          // Resolve team id/slug to friendly name using component.costTeams
          const costTeamsList = component && component.costTeams ? (Array.isArray(component.costTeams.teams) ? component.costTeams.teams : (Array.isArray(component.costTeams) ? component.costTeams : [])) : [];
          const teamNameByKey = {};
          for (const tt of costTeamsList) {
            try {
              if (tt.id != null) teamNameByKey[String(tt.id)] = tt.name || tt.id;
              if (tt.slug) teamNameByKey[String(tt.slug)] = tt.name || tt.slug;
              if (tt.name) teamNameByKey[String(tt.name)] = tt.name;
            } catch (e) {}
          }
          const teamsLabel = teams.map(t => teamNameByKey[t] || t).join(', ');

          const ft = (feature.type || '').toString().toLowerCase();
          const iconTemplate = (ft === 'epic' || ft === 'epics') ? epicTemplate : ((ft === 'feature' || ft === 'features') ? featureTemplate : html`<span style="display:inline-block;width:10px;">•</span>`);

          return html`
            <tr>
              <td style="text-align:center;"><span class="type-icon">${iconTemplate}</span></td>
              <td style="vertical-align:top;"> <div style="max-width:60%;">${feature.title || feature.name || feature.id}</div> </td>
              <td class="numeric">${feature.start || ''}</td>
              <td class="numeric">${feature.end || ''}</td>
              <td class="numeric">${teamsLabel}</td>
              <td class="numeric">${totalCost.toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0})}</td>
              <td class="numeric">${Math.round(totalHours)}</td>
            </tr>
          `;
        })}
      </tbody>
    </table>
  `;
}

function renderTaskNode(component, featureId, featureMap, childrenMap, depth) {
  const feature = featureMap.get(String(featureId));
  if (!feature) return '';

  const hasChildren = childrenMap.has(String(featureId));
  const children = hasChildren ? childrenMap.get(String(featureId)) : [];
  const isExpanded = component.expandedTasks.has(String(featureId));

  const metrics = feature && feature.metrics ? feature.metrics : null;
  let totalCost = 0;
  let totalHours = 0;
  if (metrics) {
    const c_internal = (metrics.internal && metrics.internal.cost) || (metrics.cost && metrics.cost.internal) || {};
    const c_external = (metrics.external && metrics.external.cost) || (metrics.cost && metrics.cost.external) || {};
    const h_internal = (metrics.internal && metrics.internal.hours) || (metrics.hours && metrics.hours.internal) || {};
    const h_external = (metrics.external && metrics.external.hours) || (metrics.hours && metrics.hours.external) || {};
    for (const v of Object.values(c_internal)) totalCost += Number(v || 0);
    for (const v of Object.values(c_external)) totalCost += Number(v || 0);
    for (const v of Object.values(h_internal)) totalHours += Number(v || 0);
    for (const v of Object.values(h_external)) totalHours += Number(v || 0);
  }

  let deviation = null;
  let childrenFeatures = [];
  if (hasChildren && children.length > 0) {
    childrenFeatures = children.map(cid => featureMap.get(String(cid))).filter(Boolean);
    deviation = calculateBudgetDeviation(feature, childrenFeatures);
  }

  const hasDeviation = deviation && hasSignificantDeviation(deviation);
  const deviationPercent = deviation ? deviation.totalCost : 0;
  const indentStyle = `margin-left: ${depth * 24}px;`;

  return html`
    <div style="${indentStyle}">
      <div 
        class="${hasChildren ? 'expandable' : ''}" 
        style="padding:8px; border-bottom:1px solid #eee;"
        @click="${hasChildren ? () => component.toggleTask(String(featureId)) : null}">
        ${hasChildren ? html`<span class="expand-icon ${isExpanded ? 'expanded' : ''}">▶</span>` : html`<span style="display:inline-block;width:20px;"></span>`}
        <strong>${feature.title || feature.name || feature.id}</strong>
        ${hasDeviation ? html`
          <span class="deviation-indicator ${Math.abs(deviationPercent) > 20 ? 'high' : 'medium'}">
            ${deviationPercent > 0 ? '+' : ''}${deviationPercent.toFixed(0)}%
          </span>
        ` : ''}
        <span style="margin-left:16px; color:#666; font-size:12px;">
          ${component.viewMode === 'cost' ? `Cost: ${totalCost.toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0})}` 
                                     : `Hours: ${totalHours.toFixed(0)}`}
        </span>
      </div>

      ${isExpanded && hasChildren ? html`
        <div style="margin-left:24px; margin-top:8px; margin-bottom:8px;">
          ${renderDeviationDetail(component, feature, childrenFeatures, deviation)}
        </div>
      ` : ''}

      ${isExpanded && hasChildren ? children.map(childId => 
        renderTaskNode(component, childId, featureMap, childrenMap, depth + 1)
      ) : ''}
    </div>
  `;
}

function renderDeviationDetail(component, parent, children, deviation) {
  const formatValue = (val) => {
    if (component.viewMode === 'hours') {
      return `${val.toFixed(0)} hrs`;
    }
    return val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  return html`
    <div style="background:#f9f9f9; padding:12px; border-radius:4px; font-size:12px;">
      <div style="font-weight:600; margin-bottom:8px;">Budget Comparison</div>
      <table style="width:auto; font-size:12px;">
        <thead>
          <tr>
            <th></th>
            <th class="numeric">Internal</th>
            <th class="numeric">External</th>
            <th class="numeric">Total</th>
            <th class="numeric">Deviation</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Parent Own</td>
            <td class="numeric">${formatValue(component.viewMode === 'cost' ? deviation.parentOwn.internalCost : deviation.parentOwn.internalHours)}</td>
            <td class="numeric">${formatValue(component.viewMode === 'cost' ? deviation.parentOwn.externalCost : deviation.parentOwn.externalHours)}</td>
            <td class="numeric">${formatValue(component.viewMode === 'cost' ? deviation.parentOwn.totalCost : deviation.parentOwn.totalHours)}</td>
            <td></td>
          </tr>
          <tr>
            <td>Children Sum</td>
            <td class="numeric">${formatValue(component.viewMode === 'cost' ? deviation.childrenSum.internalCost : deviation.childrenSum.internalHours)}</td>
            <td class="numeric">${formatValue(component.viewMode === 'cost' ? deviation.childrenSum.externalCost : deviation.childrenSum.externalHours)}</td>
            <td class="numeric">${formatValue(component.viewMode === 'cost' ? deviation.childrenSum.totalCost : deviation.childrenSum.totalHours)}</td>
            <td></td>
          </tr>
          <tr style="font-weight:600;">
            <td>Deviation</td>
            <td class="numeric">${deviation.deviation[component.viewMode === 'cost' ? 'internalCost' : 'internalHours'].toFixed(0)}%</td>
            <td class="numeric">${deviation.deviation[component.viewMode === 'cost' ? 'externalCost' : 'externalHours'].toFixed(0)}%</td>
            <td class="numeric">${deviation.deviation[component.viewMode === 'cost' ? 'totalCost' : 'totalHours'].toFixed(0)}%</td>
            <td></td>
          </tr>
        </tbody>
      </table>

      <div style="margin-top:12px;">
        <div style="font-weight:600; margin-bottom:4px;">Child Tasks (${children.length})</div>
        ${children.map(child => html`
          <div style="padding:4px 0; color:#666;">
            • ${child.title || child.name || child.id}
          </div>
        `)}
      </div>
    </div>
  `;
}
