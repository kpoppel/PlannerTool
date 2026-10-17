import { html } from '../../vendor/lit.js';
import { formatManDays, getAllocationBasis, percentToManDays } from '../../application/shared/allocationUnits.js';
import { ceilAllocation } from '../../application/shared/teamAllocation.js';

const capacityInputCommits = new WeakMap();
const capacityWheelTimers = new WeakMap();
const WHEEL_COMMIT_DELAY = 75;

/**
 * Project allocation presentation without changing feature or team data.
 * @param {{capacity: object[], orgLoad: string, teams: object[], showAddTeamPopover: boolean}} input
 */
export function buildDetailsPanelCapacityModel({ capacity, orgLoad, teams, availability,
  showAddTeamPopover, allocation, feature }) {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const manDays = allocation.unit === 'man-days';
  function inputModel(teamId, percent) {
    if (!manDays) return { inputValue: ceilAllocation(percent), max: 100, reason: '' };
    const basis = getAllocationBasis(teamId, feature, allocation.staffing.fteById);
    const reason = allocation.staffing.status !== 'ready' ? 'Staffing is unavailable'
      : !teamsById.has(teamId) ? 'Team staffing is unknown' : basis.reason;
    return { inputValue: reason === ''
      ? formatManDays(percentToManDays(percent, basis.fte, basis.days)) : '',
    max: basis.max, reason };
  }
  const rows = [];
  let totalCapacity = 0;
  for (const allocation of capacity) {
    totalCapacity += allocation.capacity;
    const team = teamsById.get(allocation.team);
    if (team === undefined) {
      rows.push({
        teamId: allocation.team,
        name: `Unknown allocation: ${allocation.team}`,
        color: '#b42318',
        unknown: true,
        capacity: allocation.capacity,
        barWidth: Math.min(allocation.capacity, 100),
        ...inputModel(allocation.team, allocation.capacity),
      });
    } else {
      rows.push({
        teamId: team.id,
        name: team.name,
        color: team.color,
        unknown: false,
        capacity: allocation.capacity,
        barWidth: Math.min(allocation.capacity, 100),
        ...inputModel(allocation.team, allocation.capacity),
      });
    }
  }
  const allocatedTeamIds = new Set(capacity.map((allocation) => allocation.team));
  return {
    manDays,
    rows,
    availableTeams: teams.filter((team) => availability.allowed_ids.includes(team.id)
      && !allocatedTeamIds.has(team.id)).map((team) => ({ ...team, ...inputModel(team.id, 0) })),
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

function stepCapacityInput(event, manDays) {
  event.preventDefault();
  if (event.target.disabled) return event.target.value;
  if (manDays) {
    const current = Number(event.target.value);
    event.target.value = formatManDays(Math.max(0,
      Math.min(Number(event.target.max), current + (event.deltaY < 0 ? 1 : -1))));
    return event.target.value;
  }
  const parsed = parseInt(event.target.value, 10);
  const current = Number.isNaN(parsed) ? 0 : parsed;
  const delta = event.deltaY < 0 ? 10 : -10;
  const next = Math.max(0, Math.min(100, current + delta));
  event.target.value = Math.round(next / 10) * 10;
  return event.target.value;
}

function commitCapacityInput(event, row, model, actions) {
  const input = event.target;
  cancelCapacityWheel(input);
  if (input.value !== '' && Number(input.value) === Number(row.inputValue)) return;
  if (model.manDays) {
    if (input.value === '' || !input.checkValidity()) {
      input.reportValidity();
      return;
    }
  }
  const committed = capacityInputCommits.get(input);
  if (committed !== undefined && committed.row === row && committed.value === input.value) return;
  const result = actions.changeCapacity(row.teamId, input.value);
  if (result !== false) {
    if (model.manDays && typeof result === 'string') input.value = result;
    capacityInputCommits.set(input, { row, value: input.value });
  }
}

function cancelCapacityWheel(input) {
  clearTimeout(capacityWheelTimers.get(input));
  capacityWheelTimers.delete(input);
}

function queueCapacityWheel(event, row, model, actions) {
  const input = event.target;
  stepCapacityInput(event, model.manDays);
  if (input.disabled) return;
  cancelCapacityWheel(input);
  capacityWheelTimers.set(input, setTimeout(() => {
    capacityWheelTimers.delete(input);
    // Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
    if (!input.isConnected) return;
    commitCapacityInput({ target: input }, row, model, actions);
  }, WHEEL_COMMIT_DELAY));
}

/** Render a capacity model using value-based actions, without a panel host. */
export function renderDetailsPanelCapacity({ model, actions }) {
  return html`
    <div class="capacity-section">
      <div class="details-label">Allocated Capacity${model.manDays ? ' (man-days)' : ''}:</div>
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
                  <span class="capacity-bar-label">${ceilAllocation(row.capacity)}%</span>
                </div>
              </div>
              <div class="capacity-bar-input-container" title=${row.reason}>
                <input type="number" class="capacity-bar-input" min="0" max=${row.max}
                  step="1" ?required=${model.manDays}
                  aria-label=${`${row.name} allocation ${model.manDays ? 'man-days' : 'percent'}`}
                  ?disabled=${row.reason !== ''}
                  .value=${row.inputValue}
                  @keydown=${(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitCapacityInput(event, row, model, actions);
                    } else if (event.key === 'Escape') {
                      cancelCapacityWheel(event.target);
                      event.target.value = row.inputValue;
                      actions.cancelEdit();
                    }
                  }}
                  @blur=${(event) => commitCapacityInput(event, row, model, actions)}
                  @focus=${(event) => event.target.select()}
                  @wheel=${(event) => queueCapacityWheel(event, row, model, actions)}
                />
              </div>
            </div>
            ${row.reason !== '' ? html`<div class="allocation-reason">${row.reason}</div>` : ''}
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
            <select required aria-label="Allocation team" @change=${(event) => {
              const team = model.availableTeams.find((item) => item.id === event.target.value);
              const form = event.target.form;
              const input = form.querySelector('input');
              const unavailable = model.manDays && (team === undefined || team.reason !== '');
              input.disabled = unavailable;
              input.max = team === undefined ? '0' : String(team.max);
              input.title = team === undefined ? '' : team.reason;
              form.querySelector('button[type="submit"]').disabled = unavailable;
            }}>
              <option value="">Select Team...</option>
              ${model.availableTeams.map((team) => html`
                <option value=${team.id}>${team.name}</option>
              `)}
            </select>
            <div class="add-team-form-input-row">
              <input type="number" min="0" max="100" step="1"
                placeholder=${model.manDays ? 'Man-days' : 'Capacity %'} required
                aria-label=${model.manDays ? 'New allocation man-days' : 'New allocation percent'}
                ?disabled=${model.manDays}
                @wheel=${(event) => stepCapacityInput(event, model.manDays)} />
            </div>
            <div class="add-team-form-buttons">
              <button type="submit" ?disabled=${model.manDays}>Add</button>
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
