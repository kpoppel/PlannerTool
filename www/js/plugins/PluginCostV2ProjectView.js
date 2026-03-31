import { html } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { monthLabel, monthKey } from './PluginCostV2Calculator.js';
import { expandDataset } from './PluginCostV2Calculator.js';
import { epicTemplate, featureTemplate } from '../services/IconService.js';

function getTeamLabel(component, teamKey) {
  const costTeams =
    component && component.costTeams && Array.isArray(component.costTeams.teams) ?
      component.costTeams.teams
    : [];
  for (const t of costTeams) {
    if (!t) continue;
    if (
      t.id === teamKey ||
      t.name === teamKey ||
      (t.short_name && t.short_name === teamKey)
    )
      return t.name;
  }
  // Fallback: strip common prefixes and titleize slug
  if (!teamKey) return '';
  let key = String(teamKey);
  key = key.replace(/^team-/, '');
  key = key.replace(/[-_]+/g, ' ');
  // simple title-case
  key = key
    .split(' ')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
  // replace ' And ' with ' & '
  key = key.replace(/\bAnd\b/g, '&');
  return key;
}

function formatPlainNumber(component, val) {
  const n = typeof val === 'number' ? val : Number(val || 0);
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

  const selectedProjects = (state.projects || []).filter((p) => p.selected);
  if (selectedProjects.length === 0) {
    return html`
      <div class="empty-state">
        <h3>No Projects Selected</h3>
        <p>Please select one or more delivery plans from the Top menu → Plan.</p>
      </div>
    `;
  }

  const monthKeys = component.months.map((m) => monthKey(m));

  return html`
    <div>
      ${selectedProjects.map((project) =>
        renderProjectTable(component, project, monthKeys)
      )}
    </div>
  `;
}

function renderProjectTable(component, project, monthKeys) {
  const projectData = component.data.projects[project.id];
  if (!projectData || !projectData.features || projectData.features.length === 0) {
    return html`
      <div style="margin-bottom:24px;">
        <div class="project-header">${project.name}</div>
        <p style="color:#999; font-size:13px; margin:8px 0;">
          No features found for this project.
        </p>
      </div>
    `;
  }

  const allFeatures = Object.values(component.data.projects || {}).flatMap(
    (p) => p.features || []
  );
  const expandedFeatures = expandDataset(
    projectData.features,
    state.childrenByEpic || new Map(),
    allFeatures
  );

  const teamAllocations = buildTeamMonthAllocations(
    component,
    expandedFeatures,
    monthKeys
  );
  const teams = Array.from(teamAllocations.keys()).sort();

  const isExpanded = component.expandedProjects.has(project.id);

  return html`
    <div style="margin-bottom: 32px;">
      ${(() => {
        // Notification banner describing current counting rules
        let sidebarMsg = '';
        try {
          const sidebar = document.querySelector('app-sidebar');
          const tfs = state.taskFilterService;
          const taskFilters = tfs ? tfs.getFilters() : null;
          const showUnplanned = taskFilters ? !!taskFilters.schedule.unplanned : true;
          const selectedTypes =
            sidebar && sidebar.selectedTaskTypes ?
              Array.from(sidebar.selectedTaskTypes).map((s) => String(s))
            : [];
          const typesLabel =
            selectedTypes.length === 0 ? 'All task types' : selectedTypes.join(', ');
          const levelMsg =
            selectedTypes.length > 1 ? 'Children (lowest-level) are authoritative'
            : selectedTypes.length === 1 ? `${selectedTypes[0]} selected`
            : 'All task types';
          sidebarMsg = `${typesLabel} · ${showUnplanned ? 'Counting Unplanned work' : 'Excluding Unplanned work'} · ${levelMsg}`;
        } catch (e) {
          sidebarMsg = '';
        }
        return sidebarMsg ?
            html`<div
              style="margin-bottom:8px;padding:8px;border-radius:6px;background:#fffbe6;border:1px solid #f0e6b6;color:#333;font-size:13px;"
            >
              ${sidebarMsg}
            </div>`
          : '';
      })()}
      <div
        class="project-header expandable"
        @click="${() => component.toggleProject(project.id)}"
      >
        <span class="expand-icon ${isExpanded ? 'expanded' : ''}">▶</span>
        ${project.name}
      </div>
      ${isExpanded ?
        html`
          <div style="margin-top:8px; margin-left:8px;">
            ${renderProjectSummaryTable(
              component,
              projectData,
              teams,
              teamAllocations,
              monthKeys
            )}

            <div style="display:flex; gap:8px; align-items:center; margin:6px 0 12px 0;">
              <div style="font-size:13px; color:#666;">Show:</div>
              ${(() => {
                const selected =
                  component.projectViewSelection &&
                  component.projectViewSelection[project.id];
                return html`
                  <button
                    class="project-toggle-btn ${selected === 'teams' ? 'active' : ''}"
                    aria-pressed="${selected === 'teams' ? 'true' : 'false'}"
                    @click="${() => component.setProjectView(project.id, 'teams')}"
                  >
                    Team Cost Breakdown
                  </button>
                  <button
                    class="project-toggle-btn ${selected === 'features' ? 'active' : ''}"
                    aria-pressed="${selected === 'features' ? 'true' : 'false'}"
                    @click="${() => component.setProjectView(project.id, 'features')}"
                  >
                    Features in Project
                  </button>
                `;
              })()}
            </div>

            ${(() => {
              const selectedView =
                component.projectViewSelection &&
                component.projectViewSelection[project.id];
              if (!selectedView) {
                return html`<div style="color:#888; font-size:13px; margin-left:8px;">
                  Select a view above to show more details.
                </div>`;
              }
              return selectedView === 'features' ?
                  html`<div style="margin-left:16px;">
                    ${renderFeatureList(component, expandedFeatures, monthKeys)}
                  </div>`
                : html`<div>
                    ${renderTeamMonthTable(component, teams, teamAllocations, monthKeys)}
                  </div>`;
            })()}
          </div>
        `
      : ''}
    </div>
  `;
}

function buildTeamMonthAllocations(component, features, monthKeys) {
  const teamAllocations = new Map();

  // Avoid double-counting when the same feature appears multiple times
  // in the expanded dataset (e.g., present under multiple projects).
  const seenFeatures = new Set();
  // Track seen contribution keys to avoid adding the same feature->team->month
  // multiple times (shape: `${team}|${fid}|${metricType}|${direction}|${mKey}`).
  const seenContrib = new Set();
  // Precompute set of feature ids present in the expanded dataset so we only
  // skip parent features when their children are actually included in the
  // dataset (i.e. when children are authoritative). This allows epics to be
  // counted when the sidebar selection includes only epics and no children.
  const featureIdSet = new Set((features || []).map((f) => String(f && f.id)));

  for (const feature of features) {
    const fid = feature && (feature.id || feature.id === 0) ? String(feature.id) : null;
    try {
      const childrenMap =
        state && state.childrenByEpic ? state.childrenByEpic : new Map();
      const childrenList =
        fid ? childrenMap.get(Number(fid)) || childrenMap.get(fid) || [] : [];
      // Only skip the parent if at least one child is present in our expanded dataset
      const hasChildInDataset =
        Array.isArray(childrenList) &&
        childrenList.some((cid) => featureIdSet.has(String(cid)));
      if (hasChildInDataset) continue;
    } catch (e) {}
    if (fid && seenFeatures.has(fid)) continue;
    if (fid) seenFeatures.add(fid);
    const serversideTeams =
      feature && feature.metrics && feature.metrics.teams ? feature.metrics.teams : null;
    if (!serversideTeams) continue; // do not compute client-side allocations

    for (const teamName of Object.keys(serversideTeams)) {
      const t = serversideTeams[teamName] || {};
      try {
        if (teamName === 'team-architecture') {
          console.debug('[PluginCostV2][DBG][client][trace] processing feature', {
            fid,
            teamName,
            c_internal: t.cost && t.cost.internal,
            h_internal: t.hours && t.hours.internal,
          });
        }
      } catch (e) {}
      if (!teamAllocations.has(teamName)) {
        teamAllocations.set(teamName, {
          cost: { internal: new Map(), external: new Map() },
          hours: { internal: new Map(), external: new Map() },
          totalCost: 0,
          totalHours: 0,
        });
      }
      const teamData = teamAllocations.get(teamName);
      const c_internal = (t.cost && t.cost.internal) || {};
      const c_external = (t.cost && t.cost.external) || {};
      const h_internal = (t.hours && t.hours.internal) || {};
      const h_external = (t.hours && t.hours.external) || {};
      for (const [mKey, val] of Object.entries(c_internal)) {
        const key = `${teamName}|${fid}|cost|internal|${mKey}`;
        if (seenContrib.has(key)) {
          try {
            if (teamName === 'team-architecture')
              console.debug('[PluginCostV2][DBG][client][trace] skip duplicate', key);
          } catch (e) {}
          continue;
        }
        seenContrib.add(key);
        teamData.cost.internal.set(
          mKey,
          (teamData.cost.internal.get(mKey) || 0) + Number(val || 0)
        );
      }
      for (const [mKey, val] of Object.entries(c_external)) {
        const key = `${teamName}|${fid}|cost|external|${mKey}`;
        if (seenContrib.has(key)) {
          try {
            if (teamName === 'team-architecture')
              console.debug('[PluginCostV2][DBG][client][trace] skip duplicate', key);
          } catch (e) {}
          continue;
        }
        seenContrib.add(key);
        teamData.cost.external.set(
          mKey,
          (teamData.cost.external.get(mKey) || 0) + Number(val || 0)
        );
      }
      for (const [mKey, val] of Object.entries(h_internal)) {
        const key = `${teamName}|${fid}|hours|internal|${mKey}`;
        if (seenContrib.has(key)) {
          try {
            if (teamName === 'team-architecture')
              console.debug('[PluginCostV2][DBG][client][trace] skip duplicate', key);
          } catch (e) {}
          continue;
        }
        seenContrib.add(key);
        teamData.hours.internal.set(
          mKey,
          (teamData.hours.internal.get(mKey) || 0) + Number(val || 0)
        );
      }
      for (const [mKey, val] of Object.entries(h_external)) {
        const key = `${teamName}|${fid}|hours|external|${mKey}`;
        if (seenContrib.has(key)) {
          try {
            if (teamName === 'team-architecture')
              console.debug('[PluginCostV2][DBG][client][trace] skip duplicate', key);
          } catch (e) {}
          continue;
        }
        seenContrib.add(key);
        teamData.hours.external.set(
          mKey,
          (teamData.hours.external.get(mKey) || 0) + Number(val || 0)
        );
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
    // One-off detailed debug to inspect map contents vs totals
    try {
      if (teamName === 'team-architecture') {
        const toObj = (m) =>
          m instanceof Map ? Object.fromEntries(Array.from(m.entries())) : m || {};
        console.debug('[PluginCostV2][DBG][client][detailed] team-architecture maps', {
          cost_internal: toObj(teamData.cost.internal),
          cost_external: toObj(teamData.cost.external),
          hours_internal: toObj(teamData.hours.internal),
          hours_external: toObj(teamData.hours.external),
          totalCost: teamData.totalCost,
          totalHours: teamData.totalHours,
        });
      }
    } catch (e) {}
  }

  return teamAllocations;
}

function renderProjectSummaryTable(
  component,
  projectData,
  teams,
  teamAllocations,
  monthKeys
) {
  const formatValue = (val) => formatPlainNumber(component, val);
  // Compute monthly totals for hours and cost, internal & external
  const totals = {
    internal: { hours: new Map(), cost: new Map() },
    external: { hours: new Map(), cost: new Map() },
  };

  for (const teamName of teams) {
    const teamData = teamAllocations.get(teamName);
    // One-time debug: print team allocation for server/client comparison
    try {
      if (!component.__dbg_logged_team_arch && teamName === 'team-architecture') {
        component.__dbg_logged_team_arch = true;
        console.debug('[PluginCostV2][DBG][client] team-architecture', teamData);
      }
    } catch (e) {}
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

  // One-off debug: show totals and server-provided project totals for inspection
  try {
    const pid = projectData && projectData.id ? projectData.id : '(unknown)';
    console.debug('[PluginCostV2][DBG][client][summary]', {
      project: pid,
      monthKeys,
      totals_internal_hours: Object.fromEntries(
        Array.from(totals.internal.hours.entries())
      ),
      totals_internal_cost: Object.fromEntries(
        Array.from(totals.internal.cost.entries())
      ),
      projectTotals: projectData && projectData.totals ? projectData.totals : null,
    });
  } catch (e) {}

  const sum = (map) => Array.from(map.values()).reduce((a, b) => a + b, 0);

  // Pair index to ensure Hours+Cost rows are styled as a unit across the table
  let pairIndex = 0;
  const pairClass = () => (pairIndex++ % 2 === 0 ? 'alt' : '');
  // Prefer server-provided per-site totals when available (server should centralize calculation)
  let siteTotals = {};
  const projectTotals = projectData && projectData.totals ? projectData.totals : null;

  // External per-site totals (optional shape from server if provided)
  let externalSiteTotals = {};
  if (projectTotals) {
    externalSiteTotals =
      projectTotals.external_sites ||
      projectTotals.sites_external ||
      projectTotals.externalSites ||
      {};
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
    // No server-provided per-site totals: do not compute client-side site allocations.
    // Per requirement, when the server omits site totals there's nothing to show.
    siteTotals = {};
  }

  return html`
    <table class="summary-table" style="margin-bottom:12px;">
      <thead>
        <tr>
          <th>Metric</th>
          ${component.months.map((m) => html`<th class="numeric">${monthLabel(m)}</th>`)}
          <th class="numeric sum-column">Sum</th>
        </tr>
      </thead>
      <tbody>
        <tr class="group-header-row">
          <td colspan="${component.months.length + 2}">Totals</td>
        </tr>
        ${(() => {
          const cls = pairClass();
          return html`
            <tr class="group-row ${cls}">
              <td class="metric">Hours</td>
              ${monthKeys.map(
                (mKey) =>
                  html`<td class="numeric">
                    ${formatValue(
                      (totals.internal.hours.get(mKey) || 0) +
                        (totals.external.hours.get(mKey) || 0)
                    )}
                  </td>`
              )}
              <td class="numeric totals-row sum-column">
                <strong
                  >${formatValue(
                    sum(totals.internal.hours) + sum(totals.external.hours)
                  )}</strong
                >
              </td>
            </tr>
            <tr class="group-row ${cls}">
              <td class="metric">Cost</td>
              ${monthKeys.map(
                (mKey) =>
                  html`<td class="numeric">
                    ${formatValue(
                      (totals.internal.cost.get(mKey) || 0) +
                        (totals.external.cost.get(mKey) || 0)
                    )}
                  </td>`
              )}
              <td class="numeric totals-row sum-column">
                <strong
                  >${formatValue(
                    sum(totals.internal.cost) + sum(totals.external.cost)
                  )}</strong
                >
              </td>
            </tr>
          `;
        })()}

        <tr class="group-header-row">
          <td colspan="${component.months.length + 2}">External</td>
        </tr>
        ${(() => {
          // If server provides per-site external totals, render them as pairs
          const keys = Object.keys(externalSiteTotals || {});
          if (keys.length > 0) {
            return html`${keys.sort().map((site) => {
              const cls = pairClass();
              const raw = externalSiteTotals[site] || {};
              const hoursMap = new Map();
              const costMap = new Map();
              if (raw.hours && typeof raw.hours === 'object')
                for (const k of Object.keys(raw.hours))
                  hoursMap.set(k, raw.hours[k] || 0);
              if (raw.cost && typeof raw.cost === 'object')
                for (const k of Object.keys(raw.cost)) costMap.set(k, raw.cost[k] || 0);
              return html`
                <tr class="site-pair ${cls}">
                  <td>${site} Hours</td>
                  ${monthKeys.map(
                    (mKey) =>
                      html`<td class="numeric">
                        ${formatValue(hoursMap.get(mKey) || 0)}
                      </td>`
                  )}
                  <td class="numeric sum-column">${formatValue(sum(hoursMap))}</td>
                </tr>
                <tr class="site-pair ${cls}">
                  <td>${site} Cost</td>
                  ${monthKeys.map(
                    (mKey) =>
                      html`<td class="numeric">
                        ${formatValue(costMap.get(mKey) || 0)}
                      </td>`
                  )}
                  <td class="numeric sum-column">${formatValue(sum(costMap))}</td>
                </tr>
              `;
            })}`;
          }
          const cls = pairClass();
          return html`
            <tr class="group-row ${cls}">
              <td class="metric">Sum External Hours</td>
              ${monthKeys.map(
                (mKey) =>
                  html`<td class="numeric">
                    ${formatValue(totals.external.hours.get(mKey) || 0)}
                  </td>`
              )}
              <td class="numeric sum-column">
                ${formatValue(sum(totals.external.hours))}
              </td>
            </tr>
            <tr class="group-row ${cls}">
              <td class="metric">Sum External Cost</td>
              ${monthKeys.map(
                (mKey) =>
                  html`<td class="numeric">
                    ${formatValue(totals.external.cost.get(mKey) || 0)}
                  </td>`
              )}
              <td class="numeric sum-column">
                ${formatValue(sum(totals.external.cost))}
              </td>
            </tr>
          `;
        })()}

        <tr class="group-header-row">
          <td colspan="${component.months.length + 2}">Internal</td>
        </tr>
        ${Object.keys(siteTotals)
          .sort()
          .map((site) => {
            const cls = pairClass();
            return html`
              <tr class="site-pair ${cls}">
                <td>${site} Hours</td>
                ${monthKeys.map(
                  (mKey) =>
                    html`<td class="numeric">
                      ${formatValue(siteTotals[site].hours.get(mKey) || 0)}
                    </td>`
                )}
                <td class="numeric sum-column">
                  ${formatValue(sum(siteTotals[site].hours))}
                </td>
              </tr>
              <tr class="site-pair ${cls}">
                <td>${site} Cost</td>
                ${monthKeys.map(
                  (mKey) =>
                    html`<td class="numeric">
                      ${formatValue(siteTotals[site].cost.get(mKey) || 0)}
                    </td>`
                )}
                <td class="numeric sum-column">
                  ${formatValue(sum(siteTotals[site].cost))}
                </td>
              </tr>
            `;
          })}
        ${(() => {
          const cls = pairClass();
          return html`
            <tr class="group-row ${cls}">
              <td class="metric">Sum Internal Hours</td>
              ${monthKeys.map(
                (mKey) =>
                  html`<td class="numeric">
                    ${formatValue(totals.internal.hours.get(mKey) || 0)}
                  </td>`
              )}
              <td class="numeric sum-column">
                ${formatValue(sum(totals.internal.hours))}
              </td>
            </tr>
            <tr class="group-row ${cls}">
              <td class="metric">Sum Internal Cost</td>
              ${monthKeys.map(
                (mKey) =>
                  html`<td class="numeric">
                    ${formatValue(totals.internal.cost.get(mKey) || 0)}
                  </td>`
              )}
              <td class="numeric sum-column">
                ${formatValue(sum(totals.internal.cost))}
              </td>
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
          ${component.months.map(
            (m) => html`<th class="numeric" colspan="2">${monthLabel(m)}</th>`
          )}
          <th class="numeric">Sum</th>
        </tr>
        <tr>
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
        ${teams.map((teamName) => {
          const teamData = teamAllocations.get(teamName);
          const dataMap = component.viewMode === 'cost' ? teamData.cost : teamData.hours;

          return html`
            <tr>
              <td class="team-header">${getTeamLabel(component, teamName)}</td>
              ${monthKeys.map((mKey) => {
                const intVal = dataMap.internal.get(mKey) || 0;
                const extVal = dataMap.external.get(mKey) || 0;
                return html`
                  <td class="numeric">${formatValue(intVal)}</td>
                  <td class="numeric">${formatValue(extVal)}</td>
                `;
              })}
              <td class="numeric totals-row sum-column">
                ${formatValue(
                  component.viewMode === 'cost' ? teamData.totalCost : teamData.totalHours
                )}
              </td>
            </tr>
          `;
        })}
        ${(() => {
          // Compute column sums (internal & external) per month and grand total
          const intTotals = new Map();
          const extTotals = new Map();
          for (const mKey of monthKeys) {
            intTotals.set(mKey, 0);
            extTotals.set(mKey, 0);
          }
          let grandTotal = 0;
          for (const teamName of teams) {
            const td = teamAllocations.get(teamName);
            if (!td) continue;
            const dm = component.viewMode === 'cost' ? td.cost : td.hours;
            for (const mKey of monthKeys) {
              const i = dm.internal.get(mKey) || 0;
              const e = dm.external.get(mKey) || 0;
              intTotals.set(mKey, intTotals.get(mKey) + i);
              extTotals.set(mKey, extTotals.get(mKey) + e);
            }
            grandTotal +=
              (component.viewMode === 'cost' ? td.totalCost : td.totalHours) || 0;
          }

          return html`
            <tr class="totals-row">
              <td class="metric">Sum</td>
              ${monthKeys.map(
                (mKey) =>
                  html`<td class="numeric totals-row sum-column">
                      ${formatValue(intTotals.get(mKey) || 0)}
                    </td>
                    <td class="numeric totals-row sum-column">
                      ${formatValue(extTotals.get(mKey) || 0)}
                    </td>`
              )}
              <td class="numeric totals-row sum-column">
                <strong>${formatValue(grandTotal)}</strong>
              </td>
            </tr>
          `;
        })()}
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
          <th style="width:36px;"></th>
          <th>Feature</th>
          ${component.months.map(
            (m) => html`<th class="numeric" colspan="2">${monthLabel(m)}</th>`
          )}
          <th class="numeric">Sum</th>
        </tr>
        <tr>
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
        ${features.map((feature) => {
          const metrics = feature && feature.metrics ? feature.metrics : null;
          const dataMap = {
            cost: { internal: new Map(), external: new Map() },
            hours: { internal: new Map(), external: new Map() },
          };

          if (metrics) {
            // prefer shapes: metrics.internal.cost, metrics.internal.hours or metrics.cost, metrics.hours
            const fill = (kind) => {
              const internalObj =
                (metrics.internal && metrics.internal[kind]) ||
                (metrics[kind] && metrics[kind].internal) ||
                {};
              const externalObj =
                (metrics.external && metrics.external[kind]) ||
                (metrics[kind] && metrics[kind].external) ||
                {};
              for (const [k, v] of Object.entries(internalObj || {}))
                dataMap[kind].internal.set(k, Number(v || 0));
              for (const [k, v] of Object.entries(externalObj || {}))
                dataMap[kind].external.set(k, Number(v || 0));
            };
            fill('cost');
            fill('hours');
          }

          const curMap = component.viewMode === 'cost' ? dataMap.cost : dataMap.hours;
          let total = 0;
          for (const val of curMap.internal.values()) total += val;
          for (const val of curMap.external.values()) total += val;

          return html`
            <tr>
              <td style="text-align:center;">
                ${(() => {
                  const ft = (feature.type || '').toString().toLowerCase();
                  if (ft === 'epic' || ft === 'epics') {
                    return html`<span class="type-icon epic" title="Epic"
                      >${epicTemplate}</span
                    >`;
                  }
                  if (ft === 'feature' || ft === 'features') {
                    return html`<span class="type-icon feature" title="Feature"
                      >${featureTemplate}</span
                    >`;
                  }
                  return html`<span class="type-icon" title="Task">•</span>`;
                })()}
              </td>
              <td style="vertical-align:top;">
                ${feature.title || feature.name || feature.id}
              </td>
              ${monthKeys.map((mKey) => {
                const intVal = curMap.internal.get(mKey) || 0;
                const extVal = curMap.external.get(mKey) || 0;
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
