import { html } from '../vendor/lit.js';

export function renderTeamMembersView(component) {
  let teams = component.costTeams;
  // Accept different shapes: null, array, object with `teams`, or object map
  if (!teams) return html`<div class="empty-state"><h3>No Team Members</h3><p>No team membership data available.</p></div>`;
  if (!Array.isArray(teams) && typeof teams === 'object') {
    if (Array.isArray(teams.teams)) teams = teams.teams;
    else teams = Object.values(teams || {});
  }
  if (!Array.isArray(teams) || teams.length === 0) return html`<div class="empty-state"><h3>No Team Members</h3><p>No team membership data available.</p></div>`;

  const fmtCurrency = v => (typeof v === 'number' ? v : (v && v.parsedValue ? v.parsedValue : Number(v) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return html`<div style="display:flex; flex-direction:column; gap:12px; padding:8px">
    ${teams.map(team => {
      const totals = team.totals || {};
      const internalCount = totals.internal_count || 0;
      const externalCount = totals.external_count || 0;
      const internalHours = totals.internal_hours_total || 0;
      const externalHours = totals.external_hours_total || 0;
      const internalRateTotal = totals.internal_hourly_rate_total || 0;
      const externalRateTotal = totals.external_hourly_rate_total || 0;
      const members = Array.isArray(team.members) ? team.members : [];
      const teamKey = team.id || team.name || JSON.stringify(team);
      const expanded = component.expandedTeams && component.expandedTeams.has(teamKey);
      return html`
        <div style="border:1px solid #e6e6e6; padding:10px; border-radius:6px; background:#fff">
          <div class="team-summary" @click="${() => component.toggleTeam(teamKey)}">
            <div class="team-name">${expanded ? '▾ ' : '▸ '}${team.name || team.id}</div>
            <div class="team-metrics">
              <div class="team-metric">Int: ${internalCount}</div>
              <div class="team-metric">Ext: ${externalCount}</div>
              <div class="team-metric">Int hrs: ${internalHours}</div>
              <div class="team-metric">Ext hrs: ${externalHours}</div>
              <div class="team-metric">Int rate: ${fmtCurrency(internalRateTotal)}</div>
              <div class="team-metric">Ext rate: ${fmtCurrency(externalRateTotal)}</div>
            </div>
          </div>
          ${expanded ? html`<div>
            <table class="table" style="min-width:700px; margin-bottom:4px">
              <thead>
                <tr>
                  <th class="left">Member</th>
                  <th>Site</th>
                  <th>Budget Hourly Rate</th>
                  <th>Budget Hours / mo</th>
                  <th>Budget Monthly Cost</th>
                </tr>
              </thead>
              <tbody>
                ${(() => {
                  const externals = members.filter(x => x && x.external).slice().sort((a,b)=>String((a.name||'')).localeCompare(String((b.name||''))));
                  const internals = members.filter(x => !x || !x.external ? true : false).slice().sort((a,b)=>String((a.name||'')).localeCompare(String((b.name||''))));
                  const rows = [];
                  if (internals.length) {
                    rows.push(html`<tr><td class="left" colspan="5" style="background:#f6fff6; font-weight:600">Internal Members</td></tr>`);
                    for (const m of internals) {
                      const rate = (m && m.hourly_rate && (typeof m.hourly_rate.parsedValue === 'number' ? m.hourly_rate.parsedValue : Number(m.hourly_rate.source || m.hourly_rate) || 0)) || 0;
                      const hours = (m && (m.hours_per_month || m.hours || 0)) || 0;
                      const monthly = +(rate * hours || 0);
                      rows.push(html`<tr>
                        <td class="left">${m && m.name}</td>
                        <td>${m && m.site}</td>
                        <td style="text-align:right">${fmtCurrency(m && m.hourly_rate)}</td>
                        <td style="text-align:right">${hours}</td>
                        <td style="text-align:right">${fmtCurrency(monthly)}</td>
                      </tr>`);
                    }
                  }
                  if (externals.length) {
                    rows.push(html`<tr><td class="left" colspan="5" style="background:#f9f9fb; font-weight:600">External Members</td></tr>`);
                    for (const m of externals) {
                      const rate = (m && m.hourly_rate && (typeof m.hourly_rate.parsedValue === 'number' ? m.hourly_rate.parsedValue : Number(m.hourly_rate.source || m.hourly_rate) || 0)) || 0;
                      const hours = (m && (m.hours_per_month || m.hours || 0)) || 0;
                      const monthly = +(rate * hours || 0);
                      rows.push(html`<tr>
                        <td class="left">${m && m.name}</td>
                        <td>${m && m.site}</td>
                        <td style="text-align:right">${fmtCurrency(m && m.hourly_rate)}</td>
                        <td style="text-align:right">${hours}</td>
                        <td style="text-align:right">${fmtCurrency(monthly)}</td>
                      </tr>`);
                    }
                  }
                  if (rows.length === 0) rows.push(html`<tr><td class="left" colspan="5">No members</td></tr>`);
                  return rows;
                })()}
              </tbody>
            </table>
          </div>` : ''}
        </div>`;
    })}
  </div>`;
}
