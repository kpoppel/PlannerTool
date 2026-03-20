import { html } from '../vendor/lit.js';
import { buildTaskTree, calculateBudgetDeviation, hasSignificantDeviation, allocateToMonths } from './PluginCostV2Calculator.js';
import { state } from '../services/State.js';

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
  const selectedTeams = (state.teams || []).filter(t => t.selected);
  if (selectedProjects.length === 0 || selectedTeams.length === 0) {
    return html`
      <div class="empty-state">
        <h3>No Selection</h3>
        <p>Please select projects (Top menu → Plan) and teams (Top menu → Team) to view task costs.</p>
      </div>
    `;
  }

  const selectedProjectIds = new Set(selectedProjects.map(p => String(p.id)));
  const selectedTeamIds = new Set(selectedTeams.map(t => String(t.id)));

  const allFeatures = Object.values(component.data.projects || {})
    .flatMap(p => p.features || [])
    .filter(f => selectedProjectIds.has(String(f.project)));

  const filteredFeatures = allFeatures.filter(f => {
    if (!f.capacity || f.capacity.length === 0) return false;
    return f.capacity.some(c => selectedTeamIds.has(String(c.team)));
  });

  if (filteredFeatures.length === 0) {
    return html`
      <div class="empty-state">
        <h3>No Tasks Found</h3>
        <p>No tasks found matching the selected projects and teams.</p>
      </div>
    `;
  }

  const { roots, childrenMap, parentMap } = buildTaskTree(filteredFeatures, state.childrenByEpic || new Map());
  const featureMap = new Map(filteredFeatures.map(f => [String(f.id), f]));

  return html`
    <div>
      <h3 style="margin-bottom:16px; font-size:16px; color:#333;">Task Tree (${filteredFeatures.length} tasks)</h3>
      ${roots.map(rootId => renderTaskNode(component, rootId, featureMap, childrenMap, 0))}
    </div>
  `;
}

function renderTaskNode(component, featureId, featureMap, childrenMap, depth) {
  const feature = featureMap.get(String(featureId));
  if (!feature) return '';

  const hasChildren = childrenMap.has(String(featureId));
  const children = hasChildren ? childrenMap.get(String(featureId)) : [];
  const isExpanded = component.expandedTasks.has(String(featureId));

  const allocation = allocateToMonths(feature, component.months);
  let totalCost = 0;
  let totalHours = 0;
  for (const val of allocation.cost.internal.values()) totalCost += val;
  for (const val of allocation.cost.external.values()) totalCost += val;
  for (const val of allocation.hours.internal.values()) totalHours += val;
  for (const val of allocation.hours.external.values()) totalHours += val;

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
