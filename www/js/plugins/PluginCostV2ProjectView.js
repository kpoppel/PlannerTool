import { html } from '../vendor/lit.js';
import { state } from '../services/State.js';
import {
  monthLabel,
  monthKey,
  expandDataset,
  buildTaskTree,
  flattenTree,
  buildByTeam,
  computeEffectiveDataMaps,
} from './PluginCostV2Calculator.js';
import { getIconTemplate } from '../services/IconService.js';
import { renderCountingBanner, renderClipBanner } from './PluginCostV2Shared.js';

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
  if (n === 0) return '';
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

  return html`
    <div style="margin-bottom: 32px;">
      ${renderCountingBanner()}
      ${renderClipBanner(expandedFeatures, component.startDate, component.endDate)}
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

  // Build hierarchy to know which features are roots (no parent in dataset).
  // Only root effective allocations are summed so ancestors and descendants
  // are never double-counted.
  const { roots, childrenMap } = buildTaskTree(
    features,
    state.childrenByParent || new Map()
  );

  // Per-team, per-feature rollup (respects the "children are authoritative for
  // their covered teams; uncovered teams keep the parent's own allocation" rule).
  const byTeam = buildByTeam(features, childrenMap, monthKeys);

  // Sum only the effective allocations of root features.
  // Roots already embed their entire subtree, so summing at this level avoids
  // double-counting ancestors + descendants.
  for (const rootId of roots) {
    const featureTeams = byTeam.get(String(rootId));
    if (!featureTeams) continue;

    for (const [teamName, alloc] of featureTeams.entries()) {
      if (!teamAllocations.has(teamName)) {
        teamAllocations.set(teamName, {
          cost: { internal: new Map(), external: new Map() },
          hours: { internal: new Map(), external: new Map() },
          totalCost: 0,
          totalHours: 0,
        });
      }
      const td = teamAllocations.get(teamName);
      for (const [mk, v] of alloc.cost.internal.entries())
        td.cost.internal.set(mk, (td.cost.internal.get(mk) || 0) + v);
      for (const [mk, v] of alloc.cost.external.entries())
        td.cost.external.set(mk, (td.cost.external.get(mk) || 0) + v);
      for (const [mk, v] of alloc.hours.internal.entries())
        td.hours.internal.set(mk, (td.hours.internal.get(mk) || 0) + v);
      for (const [mk, v] of alloc.hours.external.entries())
        td.hours.external.set(mk, (td.hours.external.get(mk) || 0) + v);
    }
  }

  // Compute window-only totals
  for (const [, teamData] of teamAllocations.entries()) {
    teamData.totalCost = 0;
    teamData.totalHours = 0;
    for (const mKey of monthKeys) {
      teamData.totalCost +=
        (teamData.cost.internal.get(mKey) || 0) + (teamData.cost.external.get(mKey) || 0);
      teamData.totalHours +=
        (teamData.hours.internal.get(mKey) || 0) +
        (teamData.hours.external.get(mKey) || 0);
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

  // Compute per-site internal breakdown client-side from rolled-up teamAllocations
  // and costTeams membership. This is always consistent with the team table because
  // both use the same teamAllocations object (which already applied the per-team
  // rollup rule). We no longer rely on projectTotals.sites from the server because
  // that was computed with a different (stale) skip-parent rule.
  const siteTotals = {};
  const externalSiteTotals = {};

  // Build team → site membership maps from costTeams
  const teamSiteInternal = new Map(); // teamId → { site → fractionOfTeamHours }
  const teamSiteExternal = new Map(); // teamId → { site → fractionOfTeamHours }
  const rawCostTeams =
    component.costTeams && Array.isArray(component.costTeams.teams) ?
      component.costTeams.teams
    : Array.isArray(component.costTeams) ? component.costTeams
    : [];

  for (const team of rawCostTeams) {
    if (!team) continue;
    const teamId = team.id || team.name;
    if (!teamId) continue;
    const members = Array.isArray(team.members) ? team.members : [];

    // Internal site hours
    const intSiteHours = {};
    let intTotalHours = 0;
    for (const m of members) {
      if (m && !m.external && m.site) {
        const h = Number(m.hours_per_month || 0);
        intSiteHours[m.site] = (intSiteHours[m.site] || 0) + h;
        intTotalHours += h;
      }
    }
    if (intTotalHours > 0) {
      const fracs = {};
      for (const [site, h] of Object.entries(intSiteHours))
        fracs[site] = h / intTotalHours;
      teamSiteInternal.set(teamId, fracs);
    }

    // External site hours
    const extSiteHours = {};
    let extTotalHours = 0;
    for (const m of members) {
      if (m && m.external && m.site) {
        const h = Number(m.hours_per_month || 0);
        extSiteHours[m.site] = (extSiteHours[m.site] || 0) + h;
        extTotalHours += h;
      }
    }
    if (extTotalHours > 0) {
      const fracs = {};
      for (const [site, h] of Object.entries(extSiteHours))
        fracs[site] = h / extTotalHours;
      teamSiteExternal.set(teamId, fracs);
    }
  }

  // Distribute each team's rolled-up monthly hours/cost across sites
  for (const [teamId, teamData] of teamAllocations.entries()) {
    // Internal sites
    const intFracs = teamSiteInternal.get(teamId) || {};
    for (const [site, frac] of Object.entries(intFracs)) {
      if (!siteTotals[site]) siteTotals[site] = { hours: new Map(), cost: new Map() };
      for (const mKey of monthKeys) {
        const h = (teamData.hours.internal.get(mKey) || 0) * frac;
        const c = (teamData.cost.internal.get(mKey) || 0) * frac;
        siteTotals[site].hours.set(mKey, (siteTotals[site].hours.get(mKey) || 0) + h);
        siteTotals[site].cost.set(mKey, (siteTotals[site].cost.get(mKey) || 0) + c);
      }
    }
    // External sites
    const extFracs = teamSiteExternal.get(teamId) || {};
    for (const [site, frac] of Object.entries(extFracs)) {
      if (!externalSiteTotals[site])
        externalSiteTotals[site] = { hours: new Map(), cost: new Map() };
      for (const mKey of monthKeys) {
        const h = (teamData.hours.external.get(mKey) || 0) * frac;
        const c = (teamData.cost.external.get(mKey) || 0) * frac;
        externalSiteTotals[site].hours.set(
          mKey, (externalSiteTotals[site].hours.get(mKey) || 0) + h
        );
        externalSiteTotals[site].cost.set(
          mKey, (externalSiteTotals[site].cost.get(mKey) || 0) + c
        );
      }
    }
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
          // If any external sites computed, render them as pairs
          const keys = Object.keys(externalSiteTotals || {});
          if (keys.length > 0) {
            return html`${keys.sort().map((site) => {
              const cls = pairClass();
              const hoursMap = externalSiteTotals[site].hours;
              const costMap = externalSiteTotals[site].cost;
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

// flattenTree, buildByTeam, computeEffectiveDataMaps are imported from PluginCostV2Calculator.js

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
