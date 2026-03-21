import { html } from '../vendor/lit.js';
import { monthLabel, monthKey } from './PluginCostV2Calculator.js';
import { state } from '../services/State.js';
import { epicTemplate, featureTemplate } from '../services/IconService.js';

export function renderTeamView(component) {
  if (!component.data || !component.data.projects) {
    return html`
      <div class="empty-state">
        <h3>No Team Data</h3>
        <p>No cost data available. Please ensure projects and teams are selected.</p>
      </div>
    `;
  }

  const selectedTeams = (state.teams || []).filter(t => t.selected);
  if (selectedTeams.length === 0) {
    return html`
      <div class="empty-state">
        <h3>No Teams Selected</h3>
        <p>Please select one or more teams from the Top menu → Team.</p>
      </div>
    `;
  }

  const monthKeys = component.months.map(m => monthKey(m));

  // Ensure expandedTeams set exists on component; default to expanded
  if (!component._expandedTeams) component._expandedTeams = new Set(selectedTeams.map(t => `team-${t.id}`));

  return html`
    <div>
      ${selectedTeams.map(team => renderTeamTable(component, team, monthKeys))}
    </div>
  `;
}

function renderTeamTable(component, team, monthKeys) {
  const teamId = String(team.id);
  // Collect all features from projects and deduplicate by feature id
  const rawFeatures = Object.values(component.data.projects || {}).flatMap(p => p.features || []);

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
    for (const c of existingCap) { if (c && c.team != null) capMap.set(String(c.team), Number(c.capacity) || 0); }
    for (const c of incomingCap) { if (c && c.team != null) {
        const t = String(c.team);
        const val = Number(c.capacity) || 0;
        const prev = capMap.get(t) || 0;
        capMap.set(t, Math.max(prev, val));
    }}
    // Rebuild merged capacity array
    const merged = [];
    for (const [team, cap] of capMap.entries()) merged.push({ team: team, capacity: cap });
    existing.capacity = merged;
  }
  const allFeatures = Array.from(featureById.values());

  // Count features that have a non-zero allocation for this team (scenario-aware)
  const teamFeaturesRaw = allFeatures.filter(f => f.capacity && f.capacity.some(c => String(c.team) === teamId && Number(c.capacity) > 0));

  // At this point features are already deduplicated across projects; use
  // the filtered list directly.
  let teamFeatures = teamFeaturesRaw;

  // Additional dedupe: if multiple features share the same title and project,
  // treat them as duplicates (helps when backend returns near-duplicates).
  const seenTitleProject = new Set();
  const finalFeatures = [];
  for (const f of teamFeatures) {
    const title = (f.title || f.name || '').toString().trim().toLowerCase();
    // Find project name for this feature (fallback to feature.project)
    const proj = Object.values(component.data.projects || {}).find(p => (p.features || []).some(ff => String(ff.id) === String(f.id)));
    const projectName = proj ? proj.name : (f.project || '');
    const key = title ? `${title}::${projectName}` : `id::${String(f.id)}`;
    if (seenTitleProject.has(key)) continue;
    seenTitleProject.add(key);
    finalFeatures.push(f);
  }
  teamFeatures = finalFeatures;

  const key = `team-${String(team.id)}`;
  const isExpanded = component._expandedTeams && component._expandedTeams.has(key);

  if (teamFeatures.length === 0) {
    return html`
      <div style="margin-bottom:32px;">
        <div class="team-header expandable" @click="${() => { if (!component._expandedTeams) component._expandedTeams = new Set(); if (component._expandedTeams.has(key)) component._expandedTeams.delete(key); else component._expandedTeams.add(key); component.requestUpdate(); }}">
          <span class="expand-icon ${isExpanded ? 'expanded' : ''}">▶</span>
          ${team.name}
        </div>
        ${isExpanded ? html`<p style="color:#999; font-size:13px; margin:8px 0;">No features allocated to this team.</p>` : ''}
      </div>
    `;
  }

  const formatValue = (val) => {
    if (component.viewMode === 'hours') {
      return typeof val === 'number' ? val.toFixed(0) : '0';
    }
    return typeof val === 'number' ? val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '0';
  };

  const featureAllocations = teamFeatures.map(feature => {
    const serversideTeams = feature && feature.metrics && feature.metrics.teams ? feature.metrics.teams : null;
    // Only use server-provided team buckets. If absent, skip client computation.
    if (!serversideTeams || !serversideTeams[teamId]) return null;

    const t = serversideTeams[teamId];
    const teamAllocation = {
      cost: { internal: new Map(), external: new Map() },
      hours: { internal: new Map(), external: new Map() }
    };

    const h_internal = (t.hours && t.hours.internal) || {};
    const h_external = (t.hours && t.hours.external) || {};
    const c_internal = (t.cost && t.cost.internal) || {};
    const c_external = (t.cost && t.cost.external) || {};
    for (const [mKey, val] of Object.entries(c_internal)) teamAllocation.cost.internal.set(mKey, Number(val || 0));
    for (const [mKey, val] of Object.entries(c_external)) teamAllocation.cost.external.set(mKey, Number(val || 0));
    for (const [mKey, val] of Object.entries(h_internal)) teamAllocation.hours.internal.set(mKey, Number(val || 0));
    for (const [mKey, val] of Object.entries(h_external)) teamAllocation.hours.external.set(mKey, Number(val || 0));

    return { feature, allocation: teamAllocation };
  }).filter(x => x !== null);

  const teamTotals = {
    cost: { internal: new Map(), external: new Map() },
    hours: { internal: new Map(), external: new Map() },
    totalCost: 0,
    totalHours: 0
  };

  for (const { allocation } of featureAllocations) {
    for (const [mKey, val] of allocation.cost.internal.entries()) {
      const current = teamTotals.cost.internal.get(mKey) || 0;
      teamTotals.cost.internal.set(mKey, current + val);
      teamTotals.totalCost += val;
    }
    for (const [mKey, val] of allocation.cost.external.entries()) {
      const current = teamTotals.cost.external.get(mKey) || 0;
      teamTotals.cost.external.set(mKey, current + val);
      teamTotals.totalCost += val;
    }
    for (const [mKey, val] of allocation.hours.internal.entries()) {
      const current = teamTotals.hours.internal.get(mKey) || 0;
      teamTotals.hours.internal.set(mKey, current + val);
      teamTotals.totalHours += val;
    }
    for (const [mKey, val] of allocation.hours.external.entries()) {
      const current = teamTotals.hours.external.get(mKey) || 0;
      teamTotals.hours.external.set(mKey, current + val);
      teamTotals.totalHours += val;
    }
  }

  return html`
    <div style="margin-bottom:32px;">
      <div class="team-header expandable" @click="${() => { if (!component._expandedTeams) component._expandedTeams = new Set(); if (component._expandedTeams.has(key)) component._expandedTeams.delete(key); else component._expandedTeams.add(key); component.requestUpdate(); }}">
        <span class="expand-icon ${isExpanded ? 'expanded' : ''}">▶</span>
        ${team.name} (${teamFeatures.length} features)
      </div>

      ${isExpanded ? html`<table>
        <thead>
              <tr>
                <th style="width:36px;"></th>
                <th>Feature</th>
                <th>Project</th>
                ${component.months.map(m => html`<th class="numeric" colspan="2">${monthLabel(m)}</th>`)}
                <th class="numeric">Sum</th>
              </tr>
          <tr>
            <th></th>
            <th></th>
            ${component.months.map(() => html`<th class="numeric">Int</th><th class="numeric">Ext</th>`)}
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${featureAllocations.map(({ feature, allocation }) => {
            const dataMap = component.viewMode === 'cost' ? allocation.cost : allocation.hours;
            let total = 0;
            for (const val of dataMap.internal.values()) total += val;
            for (const val of dataMap.external.values()) total += val;

            const projectData = Object.values(component.data.projects || {}).find(p => 
              (p.features || []).some(f => String(f.id) === String(feature.id))
            );
            const projectName = projectData ? projectData.name : feature.project || '-';

            const ft = (feature.type || '').toString().toLowerCase();
            const iconTemplate = (ft === 'epic' || ft === 'epics') ? epicTemplate : ((ft === 'feature' || ft === 'features') ? featureTemplate : html`<span style="display:inline-block;width:10px;">•</span>`);

            return html`
              <tr>
                <td style="text-align:center;"><span class="type-icon">${iconTemplate}</span></td>
                <td>${feature.title || feature.name || feature.id}</td>
                <td style="font-size:11px; color:#666;">${projectName}</td>
                ${monthKeys.map(mKey => {
                  const intVal = dataMap.internal.get(mKey) || 0;
                  const extVal = dataMap.external.get(mKey) || 0;
                  return html`
                    <td class="numeric">${formatValue(intVal)}</td>
                    <td class="numeric">${formatValue(extVal)}</td>
                  `;
                })}
                <td class="numeric">${formatValue(total)}</td>
              </tr>
            `;
          })}
          <tr class="totals-row">
            <td colspan="2"><strong>Team Total</strong></td>
            ${monthKeys.map(mKey => {
              const dataMap = component.viewMode === 'cost' ? teamTotals.cost : teamTotals.hours;
              const intVal = dataMap.internal.get(mKey) || 0;
              const extVal = dataMap.external.get(mKey) || 0;
              return html`
                <td class="numeric"><strong>${formatValue(intVal)}</strong></td>
                <td class="numeric"><strong>${formatValue(extVal)}</strong></td>
              `;
            })}
            <td class="numeric">
              <strong>${formatValue(component.viewMode === 'cost' ? teamTotals.totalCost : teamTotals.totalHours)}</strong>
            </td>
          </tr>
        </tbody>
      </table>` : ''}
    </div>
  `;
}
