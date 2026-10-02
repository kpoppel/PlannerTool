import { html } from '../../vendor/lit.js';

/**
 * Project allocation presentation without changing feature or team data.
 * @param {{capacity: object[], orgLoad: string, teams: object[], showAddTeamPopover: boolean}} input
 */
export function buildDetailsPanelCapacityModel({ capacity, orgLoad, teams, showAddTeamPopover }) {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const rows = [];
  let totalCapacity = 0;
  for (const allocation of capacity) {
    totalCapacity += allocation.capacity;
    const team = teamsById.get(allocation.team);
    if (team) {
      rows.push({
        teamId: team.id,
        name: team.name,
        color: team.color,
        capacity: allocation.capacity,
        barWidth: Math.min(allocation.capacity, 100),
      });
    }
  }
  const allocatedTeamIds = new Set(capacity.map((allocation) => allocation.team));
  return {
    rows,
    availableTeams: teams.filter((team) => !allocatedTeamIds.has(team.id)),
    showAddTeamPopover,
    summary: {
      visible: parseFloat(orgLoad) > 0,
      orgLoad,
      teamCount: capacity.length,
      segments: rows.map((row) => ({
        color: row.color,
        width: totalCapacity > 0 ? row.capacity / Math.max(totalCapacity, 100) * 100 : 0,
      })),
    },
  };
}

function stepCapacityInput(event) {
  event.preventDefault();
  const parsed = parseInt(event.target.value, 10);
  const current = Number.isNaN(parsed) ? 0 : parsed;
  const delta = event.deltaY < 0 ? 10 : -10;
  const next = Math.max(0, Math.min(100, current + delta));
  event.target.value = Math.round(next / 10) * 10;
  return event.target.value;
}

/** Render a capacity model using value-based actions, without a panel host. */
export function renderDetailsPanelCapacity({ model, actions }) {
  return html`
    <div class="capacity-section">
      <div class="details-label">Allocated Capacity:</div>
      <div class="capacity-bars">
        ${model.rows.map((row) => html`
          <div class="capacity-bar-row">
            <div class="capacity-bar-header">
              <span class="capacity-bar-name">${row.name}</span>
              <span class="capacity-bar-delete" @click=${(event) => {
                event.stopPropagation();
                actions.removeTeam(row.teamId);
              }}>✕</span>
            </div>
            <div class="capacity-bar-container">
              <div class="capacity-bar-bg" @click=${(event) => {
                event.stopPropagation();
                const input = event.currentTarget.parentElement.querySelector('.capacity-bar-input');
                input.focus();
                input.select();
              }}>
                <div class="capacity-bar-fill"
                  style="width: ${row.barWidth}%; background: ${row.color};">
                  <span class="capacity-bar-label">${row.capacity}%</span>
                </div>
              </div>
              <div class="capacity-bar-input-container">
                <input type="number" class="capacity-bar-input" min="0" max="100"
                  .value=${row.capacity}
                  @keydown=${(event) => {
                    if (event.key === 'Enter') actions.changeCapacity(row.teamId, event.target.value);
                    else if (event.key === 'Escape') actions.cancelEdit();
                  }}
                  @blur=${(event) => actions.changeCapacity(row.teamId, event.target.value)}
                  @focus=${(event) => event.target.select()}
                  @wheel=${(event) => actions.changeCapacity(row.teamId, stepCapacityInput(event))}
                />
              </div>
            </div>
          </div>
        `)}
      </div>
      <div class="add-team-row">
        ${model.showAddTeamPopover ? html`
          <form class="add-team-form" @submit=${(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            actions.addTeam(form.querySelector('select').value, form.querySelector('input').value);
          }}>
            <select required>
              <option value="">Select Team...</option>
              ${model.availableTeams.map((team) => html`
                <option value=${team.id}>${team.name}</option>
              `)}
            </select>
            <div class="add-team-form-input-row">
              <input type="number" min="0" max="100" placeholder="Capacity %" required
                @wheel=${stepCapacityInput} />
            </div>
            <div class="add-team-form-buttons">
              <button type="submit">Add</button>
              <button type="button" class="cancel" @click=${actions.cancelAddTeam}>Cancel</button>
            </div>
          </form>
        ` : html`
          <div class="add-team-btn" @click=${(event) => {
            event.stopPropagation();
            actions.toggleAddTeam();
          }}>+ Add Team</div>
        `}
      </div>
      ${model.summary.visible ? html`
        <div class="total-allocation-box">
          <div class="total-allocation-header">
            Total Capacity Overview:
            <span style="color: #e67e22;">${model.summary.orgLoad} across
              ${model.summary.teamCount} team${model.summary.teamCount !== 1 ? 's' : ''}</span>
          </div>
          <div class="total-allocation-summary-bar">
            ${model.summary.segments.map((segment) => html`
              <div class="total-allocation-segment"
                style="width: ${segment.width}%; background: ${segment.color};"></div>
            `)}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}
