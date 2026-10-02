import { html } from '../../vendor/lit.js';
import { getIconTemplate } from '../../services/IconService.js';

export function renderSidebarTeams({ model, actions }) {
  if (model.teams.length === 0) {
    return html`<div class="section-description">This plan has no teams assigned.</div>`;
  }
  return html`
    <div class="list-toggle">
      <button type="button" class="list-toggle-btn" @click=${actions.toggleAll}
        >${model.allSelected ? 'None' : 'All'}</button>
    </div>
    <div class="team-drilldown-grid" style="--team-type-count:${model.taskTypes.length}">
      <div class="team-drilldown-header team-drilldown-grid">
        <span></span>
        ${model.taskTypes.map((type) => html`
          <span class="type-icon" title=${type}>${getIconTemplate(type)}</span>
        `)}
      </div>
      ${model.teams.map((team) => html`
        <div class="sidebar-list-item" style="grid-column:1 / -1">
          <button type="button"
            class="chip sidebar-chip team-drilldown-row ${team.selected ? 'active' : ''}"
            aria-pressed=${team.selected ? 'true' : 'false'}
            @click=${() => actions.toggleTeam(team.id)}>
            <span class="color-dot" style="background:${team.color}"
              @click=${(event) => actions.changeColor(event, team.id)} title="Change team color"></span>
            <span class="team-name-col">
              <span>${team.name}</span>
              ${team.short ? html`<small>${team.short}</small>` : ''}
            </span>
            ${team.counts.map((count) => html`<span class="chip-badge">${count}</span>`)}
          </button>
        </div>
      `)}
    </div>
    <div class="team-view-mode-group">
      <div class="group-label" id="task-view-label">Task view</div>
      <div class="segmented-group context-group team-view-mode" role="group" aria-labelledby="task-view-label">
        <button type="button" class="segment-btn ${model.taskViewMode === 'plan' ? 'active' : ''}"
          aria-pressed=${model.taskViewMode === 'plan'}
          @click=${() => actions.setTaskViewMode('plan')}>Plan overview</button>
        <button type="button" class="segment-btn ${model.taskViewMode === 'team' ? 'active' : ''}"
          aria-pressed=${model.taskViewMode === 'team'}
          title="Show work for selected teams and its parents"
          @click=${() => actions.setTaskViewMode('team')}>Team focus</button>
      </div>
    </div>
  `;
}