import { html } from '../vendor/lit.js';
import { sel } from '../application/imports.js';
import {
  monthLabel,
  monthKey,
  expandDataset,
  buildTaskTree,
  buildCostTaskRows,
  buildByTeam,
  computeEffectiveDataMaps,
} from './PluginCostCalculator.js';
import { getIconTemplate } from '../services/IconService.js';
import { renderCountingBanner, renderClipBanner } from './PluginCostShared.js';
import { renderEstimateComparison } from './PluginCostTaskView.js';

function getTeamLabel(component, teamKey) {
  const definition = component.costTeams.catalogue.find((entry) => entry.id === teamKey);
  return definition === undefined ? `Unknown allocation: ${teamKey}` : definition.name;
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

  const selectedProjects = sel.selection.getSelectedProjects();
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

  const allFeatures = Object.values(component.data.projects).flatMap(
    (project) => project.features
  );
  const expandedFeatures = expandDataset(
    projectData.features,
    sel.feature.getChildrenByParentMap(),
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
              expandedFeatures,
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
      sel.feature.getChildrenByParentMap()
  );

  // Per-team, per-feature rollup of server-resolved allocations.
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
  features,
  teams,
  teamAllocations,
  monthKeys
) {
  const profileDefinitions = new Map();
  const profileFeatures = features.map((feature) => {
    const buckets = {};
    for (const [teamId, basis] of Object.entries(feature.metrics.teams)) {
      for (const profile of basis.profiles) {
        const identity = JSON.stringify([teamId, profile.supplier_id, profile.profile_id]);
        if (Object.hasOwn(buckets, identity)) throw new Error(`Duplicate priced profile: ${identity}`);
        profileDefinitions.set(identity, profile);
        buckets[identity] = {
          cost: { internal: profile.external ? {} : profile.cost,
            external: profile.external ? profile.cost : {} },
          hours: { internal: profile.external ? {} : profile.hours,
            external: profile.external ? profile.hours : {} },
        };
      }
    }
    return { ...feature, metrics: { ...feature.metrics, teams: buckets } };
  });
  const profileAllocations = buildTeamMonthAllocations(component, profileFeatures, monthKeys);
  const suppliers = new Map(component.costTeams.suppliers.map((supplier) => [supplier.id, supplier]));
  const accounts = ['internal', 'external'];
  const totals = new Map(accounts.map((account) => [account, {
    hours: new Map(monthKeys.map((month) => [month, 0])),
    cost: new Map(monthKeys.map((month) => [month, 0])),
  }]));
  const profiles = new Map();
  const amount = (series, month) => series.has(month) ? series.get(month) : 0;
  for (const teamId of teams) {
    const allocation = teamAllocations.get(teamId);
    for (const account of accounts) {
      for (const metric of ['hours', 'cost']) {
        for (const month of monthKeys) {
          const series = totals.get(account)[metric];
          series.set(month, series.get(month) + amount(allocation[metric][account], month));
        }
      }
    }
  }
  for (const [identity, allocation] of profileAllocations) {
    const profile = profileDefinitions.get(identity);
    const account = profile.external ? 'external' : 'internal';
    const key = JSON.stringify([profile.supplier_id, profile.profile_id]);
    if (!profiles.has(key)) {
      const supplier = suppliers.get(profile.supplier_id);
      const definition = supplier.profiles.find((entry) => entry.id === profile.profile_id);
      profiles.set(key, { account, label: `${supplier.name} / ${definition.name}`,
        hours: new Map(monthKeys.map((month) => [month, 0])),
        cost: new Map(monthKeys.map((month) => [month, 0])) });
    }
    const row = profiles.get(key);
    for (const metric of ['hours', 'cost']) {
      for (const month of monthKeys) {
        row[metric].set(month, row[metric].get(month) + amount(allocation[metric][account], month));
      }
    }
  }
  const renderPair = (label, series) => ['hours', 'cost'].map((metric) => html`<tr>
    <td>${label} ${metric === 'hours' ? 'Hours' : 'Cost'}</td>
    ${monthKeys.map((month) => html`<td class="numeric">${formatPlainNumber(component, series[metric].get(month))}</td>`)}
    <td class="numeric sum-column">${formatPlainNumber(component,
      monthKeys.reduce((sum, month) => sum + series[metric].get(month), 0))}</td>
  </tr>`);
  return html`<table class="summary-table" style="margin-bottom:12px">
    <thead><tr><th>Metric</th>${component.months.map((month) => html`<th>${monthLabel(month)}</th>`)}
      <th>Sum</th></tr></thead>
    <tbody>${accounts.map((account) => html`
      <tr class="group-header-row"><td colspan=${monthKeys.length + 2}>${account === 'internal' ? 'Internal' : 'External'}</td></tr>
      ${[...profiles.values()].filter((row) => row.account === account)
        .sort((left, right) => left.label.localeCompare(right.label)).map((row) => renderPair(row.label, row))}
      ${renderPair(account === 'internal' ? 'Internal' : 'External', totals.get(account))}
    `)}</tbody>
  </table>`;
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

  // Build hierarchy so parents always precede their children.
    const { childrenMap } = buildTaskTree(
      features,
      sel.feature.getChildrenByParentMap()
  );
  const rows = buildCostTaskRows(features, childrenMap, monthKeys,
    { start: component.startDate, end: component.endDate });

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
          <th class="numeric">Own Estimate</th>
          <th>Estimate vs Breakdown</th>
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
          <th></th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => {
          const { feature, depth } = row;
          const dataMap = effectiveDataMaps.get(String(feature.id));

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
            <tr class="${feature.displayMode === 'context' ? 'context-row' : ''}">
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
                ${feature.displayMode === 'context' ? html`<span class="context-label">Context</span>` : ''}
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
              <td class="numeric">${formatValue(component.viewMode === 'cost' ? row.ownCost : row.ownHours)}</td>
              <td>${renderEstimateComparison(row)}</td>
            </tr>
          `;
        })}
      </tbody>
    </table>
  `;
}
