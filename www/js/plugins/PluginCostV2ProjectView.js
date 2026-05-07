import { html } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { monthLabel, monthKey, expandDataset, buildTaskTree } from './PluginCostV2Calculator.js';
import { getIconTemplate } from '../services/IconService.js';

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
    state.childrenByParent || new Map(),
    allFeatures
  );

  const teamAllocations = buildTeamMonthAllocations(
    component,
    expandedFeatures,
    monthKeys
  );
  const teams = Array.from(teamAllocations.keys()).sort();

  const isExpanded = component.expandedProjects.has(project.id);

  // Count features whose dates extend outside the selected display window so we
  // can warn the user that the shown sums cover only the selected period.
  const windowStart = component.startDate || null;
  const windowEnd = component.endDate || null;
  const clippedCount = expandedFeatures.filter((f) => {
    if (!f) return false;
    const fs = f.start ? String(f.start).slice(0, 10) : null;
    const fe = f.end ? String(f.end).slice(0, 10) : null;
    return (
      (fs && windowStart && fs < windowStart) ||
      (fe && windowEnd && fe > windowEnd)
    );
  }).length;

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
      ${clippedCount > 0 ?
        html`<div
          style="margin-bottom:8px;padding:8px;border-radius:6px;background:#fff3e0;border:1px solid #ffe0b2;color:#e65100;font-size:13px;"
        >
          ⚠ ${clippedCount} feature${clippedCount > 1 ? 's extend' : ' extends'}
          beyond the selected display period. Sums reflect the selected window only.
        </div>`
      : ''}
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
    const fid = String(feature.id);
    const childrenMap = state.childrenByParent;
    const childrenList = childrenMap.get(Number(fid));
    // Only skip the parent if at least one child is present in our expanded dataset
    const hasChildInDataset =
      Array.isArray(childrenList) &&
      childrenList.some((cid) => featureIdSet.has(String(cid)));

    if (hasChildInDataset) continue;

    if (fid && seenFeatures.has(fid)) continue;
    if (fid) seenFeatures.add(fid);
    const serversideTeams =
      feature && feature.metrics && feature.metrics.teams ? feature.metrics.teams : null;
    if (!serversideTeams) continue; // do not compute client-side allocations

    for (const teamName of Object.keys(serversideTeams)) {
      const t = serversideTeams[teamName] || {};
      // DEBUG: trace processing of features and teams to investigate any discrepancies
      if (false) {
        if (teamName === 'team-architecture') {
          console.debug('[PluginCostV2][DBG][client][trace] processing feature', {
            fid,
            teamName,
            c_internal: t.cost && t.cost.internal,
            h_internal: t.hours && t.hours.internal,
          });
        }
      }

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
          if (teamName === 'team-architecture')
            console.debug('[PluginCostV2][DBG][client][trace] skip duplicate', key);
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
          if (teamName === 'team-architecture')
            console.debug('[PluginCostV2][DBG][client][trace] skip duplicate', key);
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
          if (teamName === 'team-architecture')
            console.debug('[PluginCostV2][DBG][client][trace] skip duplicate', key);
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
          if (teamName === 'team-architecture')
            console.debug('[PluginCostV2][DBG][client][trace] skip duplicate', key);
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
    // Only sum months within the display window so the Sum column matches per-column values
    for (const mKey of monthKeys) {
      teamData.totalCost +=
        (teamData.cost.internal.get(mKey) || 0) + (teamData.cost.external.get(mKey) || 0);
      teamData.totalHours +=
        (teamData.hours.internal.get(mKey) || 0) +
        (teamData.hours.external.get(mKey) || 0);
    }
    // DEBUG: One-off detailed debug to inspect map contents vs totals
    if (false) {
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
    }
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
    // DEBUG: print team allocation for server/client comparison
    if (false) {
      if (!component.__dbg_logged_team_arch && teamName === 'team-architecture') {
        component.__dbg_logged_team_arch = true;
        console.debug('[PluginCostV2][DBG][client] team-architecture', teamData);
      }
    }

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

  // DEBUG: show totals and server-provided project totals for inspection
  if (false) {
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
  }

  // Only sum the months inside the display window; the map may contain server data
  // for months outside the selected period which must not be included in the totals.
  const sum = (map) => monthKeys.reduce((a, mKey) => a + (map.get(mKey) || 0), 0);

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

/**
 * Flatten the feature hierarchy into a depth-annotated list using DFS pre-order
 * so that each parent immediately precedes its children in the rendered table.
 *
 * @param {Array<string>} ids - Feature IDs at the current level
 * @param {Map<string, Array<string>>} childrenMap - From buildTaskTree
 * @param {Map<string, Object>} featureMap - id -> feature object
 * @param {number} depth - Current nesting level
 * @param {Array<{feature: Object, depth: number}>} result - Accumulator
 * @returns {Array<{feature: Object, depth: number}>}
 */
function flattenTree(ids, childrenMap, featureMap, depth, result) {
  for (const id of ids) {
    const feature = featureMap.get(String(id));
    if (!feature) continue;
    result.push({ feature, depth });
    const children = childrenMap.get(String(id)) || [];
    flattenTree(children, childrenMap, featureMap, depth + 1, result);
  }
  return result;
}

/**
 * Compute effective (rolled-up) data maps for the feature list.
 *
 * Rules applied bottom-up per team:
 * - Leaf feature: display own server-provided metrics for each team.
 * - Parent feature: if any child in the dataset carries allocations for a team,
 *   that team's displayed value is the sum of children's effective values (not
 *   the parent's own). Teams allocated only at the parent level (no child
 *   coverage) keep the parent's own allocation.
 *
 * This means Epic-level estimates are replaced by their children wherever
 * children provide detail, while teams only specified at Epic level are
 * still respected as-is.
 *
 * @param {Array<Object>} features
 * @param {Map<string, Array<string>>} childrenMap  from buildTaskTree
 * @param {Array<string>} monthKeys  display-window month keys
 * @returns {Map<string, {cost: {internal: Map, external: Map}, hours: {internal: Map, external: Map}}>}
 */
function computeEffectiveDataMaps(features, childrenMap, monthKeys) {
  const featureMap = new Map(features.map((f) => [String(f.id), f]));

  // byTeam: featureId → teamName → {cost:{internal:Map,external:Map}, hours:{...}}
  const byTeam = new Map();

  const mkAlloc = () => ({
    cost: { internal: new Map(), external: new Map() },
    hours: { internal: new Map(), external: new Map() },
  });

  const addAllocs = (dst, src) => {
    for (const kind of ['cost', 'hours'])
      for (const dir of ['internal', 'external'])
        for (const [mk, v] of src[kind][dir].entries())
          dst[kind][dir].set(mk, (dst[kind][dir].get(mk) || 0) + v);
  };

  // Extract one team's alloc from server data, restricted to display monthKeys
  const fromServerTeam = (teamData) => {
    const alloc = mkAlloc();
    for (const kind of ['cost', 'hours'])
      for (const dir of ['internal', 'external']) {
        const obj = (teamData[kind] && teamData[kind][dir]) || {};
        for (const mk of monthKeys)
          if (obj[mk] != null) alloc[kind][dir].set(mk, Number(obj[mk]));
      }
    return alloc;
  };

  // Fallback when no per-team data: build alloc from flat totals
  const fromFlatMetrics = (metrics) => {
    const alloc = mkAlloc();
    for (const kind of ['cost', 'hours']) {
      const intObj =
        (metrics.internal && metrics.internal[kind]) ||
        (metrics[kind] && metrics[kind].internal) ||
        {};
      const extObj =
        (metrics.external && metrics.external[kind]) ||
        (metrics[kind] && metrics[kind].external) ||
        {};
      for (const mk of monthKeys) {
        if (intObj[mk] != null) alloc[kind].internal.set(mk, Number(intObj[mk]));
        if (extObj[mk] != null) alloc[kind].external.set(mk, Number(extObj[mk]));
      }
    }
    return alloc;
  };

  // Post-order DFS: leaves before parents so rollup is available when needed
  function processNode(fid) {
    if (byTeam.has(fid)) return;
    const feature = featureMap.get(fid);
    if (!feature) { byTeam.set(fid, new Map()); return; }

    const children = (childrenMap.get(fid) || []).map(String);
    for (const cid of children) processNode(cid);

    const ownTeams = (feature.metrics && feature.metrics.teams) || {};
    const hasOwnTeams = Object.keys(ownTeams).length > 0;
    const teamResult = new Map();

    if (children.length === 0) {
      // Leaf: use own per-team data, or flat metrics when no per-team breakdown
      if (hasOwnTeams) {
        for (const [teamName, teamData] of Object.entries(ownTeams))
          teamResult.set(teamName, fromServerTeam(teamData));
      } else if (feature.metrics) {
        teamResult.set('__flat__', fromFlatMetrics(feature.metrics));
      }
    } else {
      // Which teams does at least one direct child cover?
      const childCoveredTeams = new Set();
      for (const cid of children) {
        const ct = (featureMap.get(cid)?.metrics?.teams) || {};
        for (const t of Object.keys(ct)) childCoveredTeams.add(t);
      }

      if (hasOwnTeams) {
        for (const [teamName, teamData] of Object.entries(ownTeams)) {
          if (childCoveredTeams.has(teamName)) {
            // Sum children's effective contribution for this team
            const merged = mkAlloc();
            for (const cid of children) {
              const a = byTeam.get(cid)?.get(teamName);
              if (a) addAllocs(merged, a);
            }
            teamResult.set(teamName, merged);
          } else {
            // No child covers this team — use own allocation
            teamResult.set(teamName, fromServerTeam(teamData));
          }
        }
      }

      // Pass through teams that children have but the parent doesn't own
      const allChildTeams = new Set();
      for (const cid of children) {
        const cm = byTeam.get(cid);
        if (cm) for (const t of cm.keys()) allChildTeams.add(t);
      }
      for (const teamName of allChildTeams) {
        if (teamResult.has(teamName)) continue;
        const merged = mkAlloc();
        for (const cid of children) {
          const a = byTeam.get(cid)?.get(teamName);
          if (a) addAllocs(merged, a);
        }
        teamResult.set(teamName, merged);
      }
    }

    byTeam.set(fid, teamResult);
  }

  for (const f of features) processNode(String(f.id));

  // Aggregate all per-team allocs into a single totals dataMap per feature
  const result = new Map();
  for (const [fid, teamMap] of byTeam.entries()) {
    const dataMap = {
      cost: { internal: new Map(), external: new Map() },
      hours: { internal: new Map(), external: new Map() },
    };
    for (const alloc of teamMap.values()) addAllocs(dataMap, alloc);
    result.set(fid, dataMap);
  }
  return result;
}

function renderFeatureList(component, features, monthKeys) {
  const formatValue = (val) => formatPlainNumber(component, val);

  // Build hierarchy so parents always precede their children.
  const featureMap = new Map(features.map((f) => [String(f.id), f]));
  const { roots, childrenMap } = buildTaskTree(
    features,
    state.childrenByParent || new Map()
  );
  const orderedFeatures = flattenTree(roots, childrenMap, featureMap, 0, []);

  // Compute rolled-up effective metrics once for all features before rendering.
  const effectiveDataMaps = computeEffectiveDataMaps(features, childrenMap, monthKeys);

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
        ${orderedFeatures.map(({ feature, depth }) => {
          // Use rolled-up effective dataMap; fall back to empty maps if unavailable.
          const dataMap = effectiveDataMaps.get(String(feature.id)) || {
            cost: { internal: new Map(), external: new Map() },
            hours: { internal: new Map(), external: new Map() },
          };

          const curMap = component.viewMode === 'cost' ? dataMap.cost : dataMap.hours;
          // Only sum months in the display window; the map may include server data
          // for months outside the selected period.
          let total = 0;
          for (const mKey of monthKeys) {
            total +=
              (curMap.internal.get(mKey) || 0) + (curMap.external.get(mKey) || 0);
          }

          // Clip detection: flag features whose dates extend outside the display window
          const featureStart = feature.start ? String(feature.start).slice(0, 10) : null;
          const featureEnd = feature.end ? String(feature.end).slice(0, 10) : null;
          const headClipped =
            featureStart && component.startDate && featureStart < component.startDate;
          const tailClipped =
            featureEnd && component.endDate && featureEnd > component.endDate;

          return html`
            <tr>
              <td style="text-align:center; white-space:nowrap;">
                ${headClipped ?
                  html`<span class="clip-warning" title="Starts ${featureStart} — before display window start (${component.startDate})">◀</span>`
                : ''}
                <span class="type-icon ${(feature.type || '').toLowerCase()}" title="${feature.type || 'Task'}">${getIconTemplate(feature.type)}</span>
                ${tailClipped ?
                  html`<span class="clip-warning" title="Ends ${featureEnd} — after display window end (${component.endDate})">▶</span>`
                : ''}
              </td>
              <td style="vertical-align:top; padding-left:${8 + depth * 20}px;" data-depth="${depth}">
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
