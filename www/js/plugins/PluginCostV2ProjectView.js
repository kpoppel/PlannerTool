import { html } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { monthLabel, monthKey } from './PluginCostV2Calculator.js';
import { expandDataset, allocateToMonths } from './PluginCostV2Calculator.js';

function getTeamLabel(component, teamKey) {
  const costTeams = (component && component.costTeams && Array.isArray(component.costTeams.teams)) ? component.costTeams.teams : [];
  for (const t of costTeams) {
    if (!t) continue;
    if (t.id === teamKey || t.name === teamKey || (t.short_name && t.short_name === teamKey)) return t.name;
  }
  // Fallback: strip common prefixes and titleize slug
  if (!teamKey) return '';
  let key = String(teamKey);
  key = key.replace(/^team-/, '');
  key = key.replace(/[-_]+/g, ' ');
  // simple title-case
  key = key.split(' ').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
  // replace ' And ' with ' & '
  key = key.replace(/\bAnd\b/g, '&');
  return key;
}

function formatPlainNumber(component, val) {
  const n = (typeof val === 'number') ? val : Number(val || 0);
  // Display plain integer numbers without thousand separators.
  return String(Math.round(n));
}

export function renderProjectView(component) {
  if (!component.data || !component.data.projects) {
    return html`
      <div class="empty-state">
        <h3>No Project Data</h3>
        <p>No cost data available. Please ensure projects and teams are selected.</p>
      </div>
    `;
  }

  const selectedProjects = (state.projects || []).filter(p => p.selected);
  if (selectedProjects.length === 0) {
    return html`
      <div class="empty-state">
        <h3>No Projects Selected</h3>
        <p>Please select one or more delivery plans from the Top menu → Plan.</p>
      </div>
    `;
  }

  const monthKeys = component.months.map(m => monthKey(m));

  return html`
    <div>
      ${selectedProjects.map(project => renderProjectTable(component, project, monthKeys))}
    </div>
  `;
}

function renderProjectTable(component, project, monthKeys) {
  const projectData = component.data.projects[project.id];
  if (!projectData || !projectData.features || projectData.features.length === 0) {
    return html`
      <div style="margin-bottom:24px;">
        <div class="project-header">${project.name}</div>
        <p style="color:#999; font-size:13px; margin:8px 0;">No features found for this project.</p>
      </div>
    `;
  }

  const allFeatures = Object.values(component.data.projects || {}).flatMap(p => p.features || []);
  const expandedFeatures = expandDataset(projectData.features, state.childrenByEpic || new Map(), allFeatures);

  const teamAllocations = buildTeamMonthAllocations(component, expandedFeatures, monthKeys);
  const teams = Array.from(teamAllocations.keys()).sort();

  const isExpanded = component.expandedProjects.has(project.id);

  return html`
    <div style="margin-bottom: 32px;">
      <div 
        class="project-header expandable" 
        @click="${() => component.toggleProject(project.id)}">
        <span class="expand-icon ${isExpanded ? 'expanded' : ''}">▶</span>
        ${project.name}
      </div>
      ${isExpanded ? html`
        <div style="margin-top:8px; margin-left:8px;">
          ${renderProjectSummaryTable(component, projectData, teams, teamAllocations, monthKeys)}

          <div style="display:flex; gap:8px; align-items:center; margin:6px 0 12px 0;">
            <div style="font-size:13px; color:#666;">Show:</div>
            ${(() => {
              const selected = (component.projectViewSelection && component.projectViewSelection[project.id]);
              return html`
                <button
                  class="project-toggle-btn ${selected === 'teams' ? 'active' : ''}"
                  aria-pressed="${selected === 'teams' ? 'true' : 'false'}"
                  @click="${() => component.setProjectView(project.id, 'teams')}">
                  Team Cost Breakdown
                </button>
                <button
                  class="project-toggle-btn ${selected === 'features' ? 'active' : ''}"
                  aria-pressed="${selected === 'features' ? 'true' : 'false'}"
                  @click="${() => component.setProjectView(project.id, 'features')}">
                  Features in Project
                </button>
              `;
            })()}
          </div>

          ${(() => {
            const selectedView = (component.projectViewSelection && component.projectViewSelection[project.id]);
            if (!selectedView) {
              return html`<div style="color:#888; font-size:13px; margin-left:8px;">Select a view above to show more details.</div>`;
            }
            return selectedView === 'features'
              ? html`<div style="margin-left:16px;">${renderFeatureList(component, expandedFeatures, monthKeys)}</div>`
              : html`<div>${renderTeamMonthTable(component, teams, teamAllocations, monthKeys)}</div>`;
          })()}
        </div>
      ` : ''}
    </div>
  `;
}

function buildTeamMonthAllocations(component, features, monthKeys) {
  const teamAllocations = new Map();

  for (const feature of features) {
    const allocation = allocateToMonths(feature, component.months);

    const teams = (feature.capacity || []).map(c => c.team);
    if (teams.length === 0) continue;

    for (const teamCapacity of (feature.capacity || [])) {
      const teamName = teamCapacity.team;
      const teamFraction = (teamCapacity.capacity || 0) / 100;

      if (!teamAllocations.has(teamName)) {
        teamAllocations.set(teamName, {
          cost: { internal: new Map(), external: new Map() },
          hours: { internal: new Map(), external: new Map() },
          totalCost: 0,
          totalHours: 0
        });
      }

      const teamData = teamAllocations.get(teamName);

      for (const [mKey, val] of allocation.cost.internal.entries()) {
        const current = teamData.cost.internal.get(mKey) || 0;
        teamData.cost.internal.set(mKey, current + (val * teamFraction));
      }
      for (const [mKey, val] of allocation.cost.external.entries()) {
        const current = teamData.cost.external.get(mKey) || 0;
        teamData.cost.external.set(mKey, current + (val * teamFraction));
      }
      for (const [mKey, val] of allocation.hours.internal.entries()) {
        const current = teamData.hours.internal.get(mKey) || 0;
        teamData.hours.internal.set(mKey, current + (val * teamFraction));
      }
      for (const [mKey, val] of allocation.hours.external.entries()) {
        const current = teamData.hours.external.get(mKey) || 0;
        teamData.hours.external.set(mKey, current + (val * teamFraction));
      }
    }
  }

  for (const [teamName, teamData] of teamAllocations.entries()) {
    teamData.totalCost = 0;
    teamData.totalHours = 0;
    for (const val of teamData.cost.internal.values()) teamData.totalCost += val;
    for (const val of teamData.cost.external.values()) teamData.totalCost += val;
    for (const val of teamData.hours.internal.values()) teamData.totalHours += val;
    for (const val of teamData.hours.external.values()) teamData.totalHours += val;
  }

  return teamAllocations;
}

function renderProjectSummaryTable(component, projectData, teams, teamAllocations, monthKeys) {
  const formatValue = (val) => formatPlainNumber(component, val);
  // Compute monthly totals for hours and cost, internal & external
  const totals = {
    internal: { hours: new Map(), cost: new Map() },
    external: { hours: new Map(), cost: new Map() }
  };

  for (const teamName of teams) {
    const teamData = teamAllocations.get(teamName);
    if (!teamData) continue;
    for (const mKey of monthKeys) {
      const iHours = teamData.hours.internal.get(mKey) || 0;
      const eHours = teamData.hours.external.get(mKey) || 0;
      const iCost = teamData.cost.internal.get(mKey) || 0;
      const eCost = teamData.cost.external.get(mKey) || 0;

      totals.internal.hours.set(mKey, (totals.internal.hours.get(mKey) || 0) + iHours);
      totals.external.hours.set(mKey, (totals.external.hours.get(mKey) || 0) + eHours);
      totals.internal.cost.set(mKey, (totals.internal.cost.get(mKey) || 0) + iCost);
      totals.external.cost.set(mKey, (totals.external.cost.get(mKey) || 0) + eCost);
    }
  }

  const sum = (map) => Array.from(map.values()).reduce((a, b) => a + b, 0);

  // Pair index to ensure Hours+Cost rows are styled as a unit across the table
  let pairIndex = 0;
  const pairClass = () => (pairIndex++ % 2 === 0) ? 'alt' : '';
  // Prefer server-provided per-site totals when available (server should centralize calculation)
  let siteTotals = {};
  const projectTotals = projectData && projectData.totals ? projectData.totals : null;

  // External per-site totals (optional shape from server if provided)
  let externalSiteTotals = {};
  if (projectTotals) {
    externalSiteTotals = projectTotals.external_sites || projectTotals.sites_external || projectTotals.externalSites || {};
  }
  if (projectTotals && projectTotals.sites) {
    // Expecting shape: { sites: { SITE_NAME: { hours: { mKey: value }, cost: { mKey: value } } } }
    for (const siteName of Object.keys(projectTotals.sites)) {
      const raw = projectTotals.sites[siteName] || {};
      const hoursMap = new Map();
      const costMap = new Map();
      // raw.hours and raw.cost may be objects keyed by monthKey
      if (raw.hours && typeof raw.hours === 'object') {
        for (const k of Object.keys(raw.hours)) hoursMap.set(k, raw.hours[k] || 0);
      }
      if (raw.cost && typeof raw.cost === 'object') {
        for (const k of Object.keys(raw.cost)) costMap.set(k, raw.cost[k] || 0);
      }
      siteTotals[siteName] = { hours: hoursMap, cost: costMap };
    }
  } else {
    // Fallback: compute client-side site allocation using costTeams metadata (not preferred)
    console.warn('[PluginCostV2] Server did not provide per-site totals; falling back to client-side allocation. Consider moving aggregation to server.');
    const costTeams = (component.costTeams && component.costTeams.teams) ? component.costTeams.teams : [];
    const teamSiteFractions = new Map();
    for (const ct of costTeams) {
      let totalInternal = 0;
      const bySite = {};
      if (Array.isArray(ct.members)) {
        for (const m of ct.members) {
          if (m.external) continue;
          const hours = (m.hours_per_month || 0);
          const site = m.site || 'Unknown';
          bySite[site] = (bySite[site] || 0) + hours;
          totalInternal += hours;
        }
      }
      if (totalInternal > 0) {
        const fractions = {};
        for (const s of Object.keys(bySite)) fractions[s] = bySite[s] / totalInternal;
        teamSiteFractions.set(ct.id, fractions);
        teamSiteFractions.set(ct.name, fractions);
        if (ct.short_name) teamSiteFractions.set(ct.short_name, fractions);
      }
    }

    for (const teamName of teams) {
      const teamData = teamAllocations.get(teamName);
      if (!teamData) continue;
      const fractions = teamSiteFractions.get(teamName) || {};
      if (Object.keys(fractions).length === 0) continue;
      for (const mKey of monthKeys) {
        const iHours = teamData.hours.internal.get(mKey) || 0;
        const iCost = teamData.cost.internal.get(mKey) || 0;
        for (const site of Object.keys(fractions)) {
          const f = fractions[site] || 0;
          if (!siteTotals[site]) siteTotals[site] = { hours: new Map(), cost: new Map() };
          siteTotals[site].hours.set(mKey, (siteTotals[site].hours.get(mKey) || 0) + (iHours * f));
          siteTotals[site].cost.set(mKey, (siteTotals[site].cost.get(mKey) || 0) + (iCost * f));
        }
      }
    }
  }

  return html`
    <table class="summary-table" style="margin-bottom:12px;">
      <thead>
        <tr>
          <th>Metric</th>
          ${component.months.map(m => html`<th class="numeric">${monthLabel(m)}</th>`) }
          <th class="numeric sum-column">Sum</th>
        </tr>
      </thead>
      <tbody>
        <tr class="group-header-row"><td colspan="${component.months.length + 2}">Totals</td></tr>
        ${(() => {
          const cls = pairClass();
          return html`
            <tr class="group-row ${cls}">
              <td class="metric">Hours</td>
              ${monthKeys.map(mKey => html`<td class="numeric">${formatValue((totals.internal.hours.get(mKey)||0) + (totals.external.hours.get(mKey)||0))}</td>`) }
              <td class="numeric totals-row sum-column"><strong>${formatValue(sum(totals.internal.hours) + sum(totals.external.hours))}</strong></td>
            </tr>
            <tr class="group-row ${cls}">
              <td class="metric">Cost</td>
              ${monthKeys.map(mKey => html`<td class="numeric">${formatValue((totals.internal.cost.get(mKey)||0) + (totals.external.cost.get(mKey)||0))}</td>`) }
              <td class="numeric totals-row sum-column"><strong>${formatValue(sum(totals.internal.cost) + sum(totals.external.cost))}</strong></td>
            </tr>
          `;
        })()}

        <tr class="group-header-row"><td colspan="${component.months.length + 2}">External</td></tr>
        ${(() => {
          // If server provides per-site external totals, render them as pairs
          const keys = Object.keys(externalSiteTotals || {});
          if (keys.length > 0) {
            return html`${keys.sort().map(site => {
              const cls = pairClass();
              const raw = externalSiteTotals[site] || {};
              const hoursMap = new Map();
              const costMap = new Map();
              if (raw.hours && typeof raw.hours === 'object') for (const k of Object.keys(raw.hours)) hoursMap.set(k, raw.hours[k] || 0);
              if (raw.cost && typeof raw.cost === 'object') for (const k of Object.keys(raw.cost)) costMap.set(k, raw.cost[k] || 0);
              return html`
                <tr class="site-pair ${cls}">
                  <td>${site} Hours</td>
                  ${monthKeys.map(mKey => html`<td class="numeric">${formatValue(hoursMap.get(mKey)||0)}</td>`) }
                  <td class="numeric sum-column">${formatValue(sum(hoursMap))}</td>
                </tr>
                <tr class="site-pair ${cls}">
                  <td>${site} Cost</td>
                  ${monthKeys.map(mKey => html`<td class="numeric">${formatValue(costMap.get(mKey)||0)}</td>`) }
                  <td class="numeric sum-column">${formatValue(sum(costMap))}</td>
                </tr>
              `;
            })}`;
          }
          const cls = pairClass();
          return html`
            <tr class="group-row ${cls}">
              <td class="metric">Hours</td>
              ${monthKeys.map(mKey => html`<td class="numeric">${formatValue(totals.external.hours.get(mKey)||0)}</td>`) }
              <td class="numeric sum-column">${formatValue(sum(totals.external.hours))}</td>
            </tr>
            <tr class="group-row ${cls}">
              <td class="metric">Cost</td>
              ${monthKeys.map(mKey => html`<td class="numeric">${formatValue(totals.external.cost.get(mKey)||0)}</td>`) }
              <td class="numeric sum-column">${formatValue(sum(totals.external.cost))}</td>
            </tr>
          `;
        })()}

        <tr class="group-header-row"><td colspan="${component.months.length + 2}">Internal</td></tr>
        ${Object.keys(siteTotals).sort().map(site => {
          const cls = pairClass();
          return html`
            <tr class="site-pair ${cls}">
              <td>${site} Hours</td>
              ${monthKeys.map(mKey => html`<td class="numeric">${formatValue(siteTotals[site].hours.get(mKey)||0)}</td>`)}
              <td class="numeric sum-column">${formatValue(sum(siteTotals[site].hours))}</td>
            </tr>
            <tr class="site-pair ${cls}">
              <td>${site} Cost</td>
              ${monthKeys.map(mKey => html`<td class="numeric">${formatValue(siteTotals[site].cost.get(mKey)||0)}</td>`)}
              <td class="numeric sum-column">${formatValue(sum(siteTotals[site].cost))}</td>
            </tr>
          `;
        })}
        ${(() => {
          const cls = pairClass();
          return html`
            <tr class="group-row ${cls}">
              <td class="metric">Hours</td>
              ${monthKeys.map(mKey => html`<td class="numeric">${formatValue(totals.internal.hours.get(mKey)||0)}</td>`)}
              <td class="numeric sum-column">${formatValue(sum(totals.internal.hours))}</td>
            </tr>
            <tr class="group-row ${cls}">
              <td class="metric">Cost</td>
              ${monthKeys.map(mKey => html`<td class="numeric">${formatValue(totals.internal.cost.get(mKey)||0)}</td>`)}
              <td class="numeric sum-column">${formatValue(sum(totals.internal.cost))}</td>
            </tr>
          `;
        })()}
      </tbody>
    </table>
  `;
}

function renderTeamMonthTable(component, teams, teamAllocations, monthKeys) {
  const formatValue = (val) => formatPlainNumber(component, val);

  return html`
    <table>
      <thead>
        <tr>
          <th>Team</th>
          ${component.months.map(m => html`<th class="numeric" colspan="2">${monthLabel(m)}</th>`)}
          <th class="numeric">Sum</th>
        </tr>
        <tr>
          <th></th>
          ${component.months.map(() => html`<th class="numeric">Int</th><th class="numeric">Ext</th>`)}
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${teams.map(teamName => {
          const teamData = teamAllocations.get(teamName);
          const dataMap = component.viewMode === 'cost' ? teamData.cost : teamData.hours;

          return html`
            <tr>
                  <td class="team-header">${getTeamLabel(component, teamName)}</td>
              ${monthKeys.map(mKey => {
                const intVal = dataMap.internal.get(mKey) || 0;
                const extVal = dataMap.external.get(mKey) || 0;
                return html`
                  <td class="numeric">${formatValue(intVal)}</td>
                  <td class="numeric">${formatValue(extVal)}</td>
                `;
              })}
              <td class="numeric totals-row sum-column">
                ${formatValue(component.viewMode === 'cost' ? teamData.totalCost : teamData.totalHours)}
              </td>
              
            </tr>
          `;
        })}
      </tbody>
    </table>
  `;
}

function renderFeatureList(component, features, monthKeys) {
  const formatValue = (val) => formatPlainNumber(component, val);

  return html`
    <table>
      <thead>
        <tr>
          <th>Feature</th>
          ${component.months.map(m => html`<th class="numeric" colspan="2">${monthLabel(m)}</th>`)}
          <th class="numeric">Sum</th>
        </tr>
        <tr>
          <th></th>
          ${component.months.map(() => html`<th class="numeric">Int</th><th class="numeric">Ext</th>`)}
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${features.map(feature => {
          const allocation = allocateToMonths(feature, component.months);
          const dataMap = component.viewMode === 'cost' ? allocation.cost : allocation.hours;

          let total = 0;
          for (const val of dataMap.internal.values()) total += val;
          for (const val of dataMap.external.values()) total += val;

          return html`
            <tr>
              <td>${feature.title || feature.name || feature.id}</td>
              ${monthKeys.map(mKey => {
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
      </tbody>
    </table>
  `;
}
