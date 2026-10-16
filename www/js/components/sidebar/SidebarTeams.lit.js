import { html } from '../../vendor/lit.js';
import { getIconTemplate } from '../../services/IconService.js';

export function renderSidebarTeams({ model, actions }) {
  if (model.teams.length === 0) {
    return html`<div class="section-description">This plan has no teams assigned.</div>`;
  }
  return html`
    <div id="team-drilldown-list" class="team-drilldown-grid"
      style="--team-columns:14px minmax(128px, 1fr)${model.taskTypes.length ? ` repeat(${model.taskTypes.length}, 32px)` : ''}">
      <div class="team-drilldown-header">
        <div class="list-toggle">
          <button type="button" class="list-toggle-btn" @click=${actions.toggleAll}
            >${model.allSelected ? 'None' : 'All'}</button>
          ${model.hasMoreCounts ? html`
            <button type="button" class="team-counts-toggle"
              aria-expanded=${model.countsOpen} aria-controls="team-drilldown-list"
              aria-label=${model.countsOpen ? 'Show only the top two task types' : 'Show all task types'}
              title=${model.countsOpen ? 'Show only the top two task types' : 'Show all task types'}
              @click=${actions.toggleCounts}>
              <span class="counts-chevron" aria-hidden="true">&#9656;</span> Counts
            </button>
          ` : ''}
        </div>
        ${model.taskTypes.map((type) => html`
          <span class="type-icon" title=${type} aria-label=${type}>${getIconTemplate(type)}</span>
        `)}
      </div>
      ${model.teams.map((team) => html`
        <div class="sidebar-list-item" style="grid-column:1 / -1">
          <button type="button"
            class="chip sidebar-chip team-drilldown-row ${team.selected ? 'active' : ''}"
            aria-pressed=${team.selected ? 'true' : 'false'}
            title=${team.name}
            @click=${() => actions.toggleTeam(team.id)}>
            <span class="color-dot" style="background:${team.color}"
              @click=${(event) => actions.changeColor(event, team.id)} title="Change team color"></span>
            <span class="team-name-col">
              <span>${team.name}</span>
              ${team.short ? html`<small>${team.short}</small>` : ''}
            </span>
            ${team.counts.map((count, index) => html`
              <span class="chip-badge ${count > 0 ? 'has-count' : ''}"
                title="${model.taskTypes[index]}: ${count}"
                aria-label="${model.taskTypes[index]}: ${count}">${count > 0 ? count : ''}</span>
            `)}
          </button>
        </div>
      `)}
    </div>
    <div class="team-view-mode-group">
      <div class="group-label shortcut-heading" id="task-view-label">Task view
        <kbd class="shortcut-pill" title="Switch task view (V)">V</kbd>
      </div>
      <div class="segmented-group context-group team-view-mode" role="group" aria-labelledby="task-view-label">
        <button type="button" class="segment-btn ${model.taskViewMode === 'plan' ? 'active' : ''}"
          aria-pressed=${model.taskViewMode === 'plan'}
          title="Show all scoped work independently of team selection"
          @click=${() => actions.setTaskViewMode('plan')}>Plan overview</button>
        <button type="button" class="segment-btn ${model.taskViewMode === 'team' ? 'active' : ''}"
          aria-pressed=${model.taskViewMode === 'team'}
          title="Show selected teams' allocated work, ancestors and unallocated descendants"
          @click=${() => actions.setTaskViewMode('team')}>Team focus</button>
      </div>
    </div>
  `;
}