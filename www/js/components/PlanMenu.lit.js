import { LitElement, html, css } from '../vendor/lit.js';
import { PALETTE } from '../services/ColorService.js';
import { cmd, sel } from '../application/imports.js';
import { bus } from '../core/EventBus.js';
import { FeatureEvents, ProjectEvents, ViewManagementEvents } from '../core/EventRegistry.js';
import { getConnectedPlanIds } from '../application/shared/ownership.js';
import { ColorPopoverLit } from './ColorPopover.lit.js';
import { getIconTemplate } from '../services/IconService.js';

/**
 * PlanMenu - Dropdown menu for Plans (Projects)
 * Shows plans grouped by configured container type with selection toggles
 */
export class PlanMenuLit extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .menu-popover {
      background: var(--color-sidebar-bg);
      color: var(--color-sidebar-text);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 6px;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
      box-sizing: border-box;
      width: max-content;
      max-width: calc(100vw - 48px);
      max-height: 500px;
      overflow-y: auto;
      padding: 12px;
      display: grid;
      grid-template-columns: var(--plan-columns);
      gap: 8px 4px;
    }

    .counts-header {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
      align-items: center;
      gap: 8px 4px;
      color: #ddd;
      position: sticky;
      top: -12px;
      z-index: 1;
      padding: 12px 0 6px;
      background: var(--color-sidebar-bg);
    }

    .plan-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 4px;
    }

    .type-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .type-icon svg {
      width: 16px;
      height: 16px;
      display: block;
    }

    .sidebar-list {
      list-style: none;
      padding: 0;
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
      row-gap: 4px;
      margin: 0;
    }

    .sidebar-list-item {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
    }

    .sidebar-chip {
      padding: 0;
      border-radius: 6px;
      background: transparent;
      box-sizing: border-box;
      min-height: 32px;
      overflow: hidden;
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
      gap: 8px 4px;
      align-items: stretch;
    }

    .sidebar-chip:hover {
      background: rgba(255, 255, 255, 0.18);
      cursor: pointer;
    }

    .sidebar-chip.active {
      background: rgb(55, 85, 130);
      border-color: transparent;
    }

    .sidebar-chip.active:hover {
      background: rgba(255, 255, 255, 0.18);
    }

    .sidebar-list .color-dot {
      width: 14px;
      border-radius: 6px 0 0 6px;
      display: inline-block;
      flex: 0 0 14px;
      align-self: stretch;
      cursor: pointer;
    }

    .sidebar-chip .project-name-col {
      min-width: 0;
      padding: 6px 4px;
      align-self: center;
      overflow-wrap: anywhere;
      font-weight: 600;
      font-size: 0.8rem;
      color: var(--color-sidebar-text);
    }

    .chip-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 20px;
      align-self: center;
      font-size: 0.75rem;
      font-weight: 400;
      font-variant-numeric: tabular-nums;
      color: var(--color-sidebar-text);
      opacity: 0.75;
    }

    .chip-badge.has-count {
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.18);
    }

    .list-toggle-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 50px;
      height: 16px;
      border: 1px solid #5481e6;
      color: #5cc8ff;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      margin-left: 3px;
      background: transparent;
    }

    .clear-hidden-btn {
      width: fit-content;
      padding: 0 8px;
      white-space: nowrap;
    }

    .divider {
      grid-column: 1 / -1;
      border-top: 1px dashed rgba(255, 255, 255, 0.32);
      margin: 4px 0;
      border-radius: 2px;
      height: 0;
    }

    .plans-group {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: subgrid;
      row-gap: 4px;
    }

    .group-label {
      grid-column: 1 / -1;
      color: var(--color-sidebar-text);
      font-size: 0.75rem;
      font-weight: 700;
      margin: 2px 0;
    }

    .focus-controls {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .focus-field {
      display: flex;
      align-items: center;
      min-height: 32px;
      border: 1px solid rgba(255, 255, 255, 0.32);
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.12);
    }

    .focus-field:focus-within {
      border-color: #5cc8ff;
    }

    .focus-field input {
      box-sizing: border-box;
      flex: 1;
      min-width: 0;
      padding: 7px 8px;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--color-sidebar-text);
      font: inherit;
      font-size: 0.8rem;
    }

    .focus-field input::placeholder {
      color: #bbb;
    }

    .focus-trigger {
      width: 32px;
      align-self: stretch;
      border: 0;
      background: transparent;
      color: var(--color-sidebar-text);
      cursor: pointer;
    }

    .focus-trigger::after {
      content: '';
      display: inline-block;
      width: 6px;
      height: 6px;
      border-right: 1.5px solid currentColor;
      border-bottom: 1.5px solid currentColor;
      transform: rotate(45deg) translateY(-2px);
    }

    .focus-options {
      max-height: 190px;
      overflow-y: auto;
      border: 1px solid rgba(255, 255, 255, 0.24);
      border-radius: 4px;
      background: var(--color-sidebar-bg);
    }

    .focus-option {
      display: block;
      width: 100%;
      padding: 7px 8px;
      border: 0;
      background: transparent;
      color: var(--color-sidebar-text);
      text-align: left;
      font: inherit;
      font-size: 0.8rem;
      cursor: pointer;
    }

    .focus-option:hover, .focus-option.active {
      background: rgba(255, 255, 255, 0.18);
    }

    .focus-option[aria-selected="true"] {
      font-weight: 700;
    }

  `;

  static properties = {
    projects: { type: Array },
    activeViewId: { type: String },
    activeViewData: { type: Object },
    _eventsOpenPlanId: { type: String, state: true },
    focusedPlanId: { type: String, state: true },
    focusSearch: { type: String, state: true },
    focusOptionsOpen: { type: Boolean, state: true },
    focusOptionIndex: { type: Number, state: true },
  };

  constructor() {
    super();
    this.projects = [];
    this.activeViewId = null;
    this.activeViewData = null;
    this.focusedPlanId = '';
    this.focusSearch = '';
    this.focusOptionsOpen = false;
    this.focusOptionIndex = 0;
  }

  connectedCallback() {
    super.connectedCallback();

    // Listen to project changes for real-time updates
    this._onProjectsChanged = () => {
      const projects = sel.selection.getProjects();
      this.projects = [...projects];
      this.requestUpdate();
    };

    this._onViewActivated = (payload) => {
      this.activeViewId = payload.id;
      this.activeViewData = payload.data;
      this.focusedPlanId = sel.view.getFocusedPlanId();
      this.focusSearch = '';
      this.focusOptionsOpen = false;
      this.requestUpdate();
    };

    bus.on(ProjectEvents.CHANGED, this._onProjectsChanged);
    this._onFeaturesChanged = () => this.requestUpdate();
    bus.on(FeatureEvents.UPDATED, this._onFeaturesChanged);
    bus.on(ViewManagementEvents.ACTIVATED, this._onViewActivated);

    this._onProjectsChanged();
    this.focusedPlanId = sel.view.getFocusedPlanId();

    // Don't initialize from state - projects are passed as properties from TopMenu
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._onProjectsChanged) bus.off(ProjectEvents.CHANGED, this._onProjectsChanged);
    if (this._onFeaturesChanged) bus.off(FeatureEvents.UPDATED, this._onFeaturesChanged);
    if (this._onViewActivated)
      bus.off(ViewManagementEvents.ACTIVATED, this._onViewActivated);
  }

  _toggleProject(pid) {
    const current = this.projects.find((p) => p.id === pid);
    const newVal = !current.selected;
    cmd.selection.setProjectSelected(pid, newVal);
  }

  _handleProjectToggle() {
    const projects = this._visibleProjects();
    const anyUnchecked = projects.some((p) => !p.selected);
    // Use bulk update to avoid O(n) capacity recalculations
    const selections = {};
    this.projects.forEach((p) => (selections[p.id] = projects.includes(p) ? anyUnchecked : p.selected));
    cmd.selection.setProjectsSelectedBulk(selections);
  }

  _clearHiddenProjects() {
    const visibleProjects = this._visibleProjects();
    const selections = Object.fromEntries(this.projects.map((project) =>
      [project.id, visibleProjects.includes(project) && project.selected]));
    cmd.selection.setProjectsSelectedBulk(selections);
  }

  _anyUncheckedProjects() {
    return this._visibleProjects().some((p) => !p.selected);
  }

  _visibleProjects() {
    if (!this.focusedPlanId) return this.projects;
    const connected = getConnectedPlanIds(this.focusedPlanId, sel.scope.getResolvedFeatures());
    return this.projects.filter((project) => connected.has(String(project.id)));
  }

  _focusOptions() {
    const query = this.focusSearch.trim().toLowerCase();
    return [null, ...this.projects.filter((project) =>
      project.name.toLowerCase().includes(query)).sort((first, second) =>
      first.container_order - second.container_order || first.name.localeCompare(second.name))];
  }

  _openFocusOptions() {
    if (this.focusOptionsOpen) return;
    this.focusSearch = '';
    this.focusOptionIndex = 0;
    this.focusOptionsOpen = true;
  }

  _chooseFocus(project) {
    this.focusedPlanId = project ? String(project.id) : '';
    cmd.view.setFocusedPlanId(this.focusedPlanId);
    this.focusSearch = '';
    this.focusOptionsOpen = false;
  }

  _onFocusKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.focusOptionsOpen = false;
      this.focusSearch = '';
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this._openFocusOptions();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      this.focusOptionIndex = (this.focusOptionIndex + direction + this._focusOptions().length) %
        this._focusOptions().length;
    } else if (event.key === 'Enter' && this.focusOptionsOpen) {
      event.preventDefault();
      this._chooseFocus(this._focusOptions()[this.focusOptionIndex]);
    }
  }

  async _openColorPopover(e, projectId) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const cp = await ColorPopoverLit.ensureInstance(PALETTE);
    await cp.updateComplete;
    cp.openFor('project', projectId, rect);
  }

  _renderProjectsList(projects, taskTypes, projectCounts) {
    return html`${projects.map((project) => {
      const counts = projectCounts.get(project.id);

      return html`
        <li class="sidebar-list-item">
          <div
            class="chip sidebar-chip ${project.selected ? 'active' : ''}"
            @click=${(e) => {
              if (!e.target.closest('.color-dot')) this._toggleProject(project.id);
            }}
          >
            <span
              class="color-dot"
              style="background:${project.color}"
              @click=${(e) => this._openColorPopover(e, project.id)}
            ></span>
            <div
              class="project-name-col"
              title="${project.name}"
            >
              ${project.name}
            </div>
            ${taskTypes.map((type) => {
              const count = counts.get(type);
              return html`<span class="chip-badge ${count > 0 ? 'has-count' : ''}"
                title=${sel.feature.getTypeDisplayName(type)}>${count > 0 ? count : ''}</span>`;
            })}
          </div>
        </li>
      `;
    })}`;
  }

  render() {
    const projects = this._visibleProjects();
    const focusedProject = this.projects.find((project) => String(project.id) === this.focusedPlanId);
    const options = this._focusOptions();
    const groups = new Map();
    for (const project of projects) {
      const type = project.type;
      if (!groups.has(type)) groups.set(type, { order: project.container_order, projects: [] });
      groups.get(type).projects.push(project);
    }
    const orderedGroups = [...groups.entries()].sort((first, second) =>
      first[1].order - second[1].order);
    const projectCounts = new Map(projects.map((project) =>
      [project.id, sel.feature.getCountsForProject(project.id)]));
    const taskTypes = sel.feature.getAvailableTaskTypesOrdered().filter((type) =>
      projects.some((project) => projectCounts.get(project.id).get(type) > 0));
    const columns = `14px minmax(0, max-content)${taskTypes.length ? ` repeat(${taskTypes.length}, 32px)` : ''}`;

    return html`
      <div class="menu-popover" style="--plan-columns: ${columns}">
        <div class="focus-controls" @focusout=${(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            this.focusOptionsOpen = false;
            this.focusSearch = '';
          }
        }}>
          <label class="group-label" for="connected-plan">Connected to</label>
          <div class="focus-field">
            <input id="connected-plan" role="combobox" type="text" aria-label="Connected to"
              aria-autocomplete="list" aria-controls="connected-plan-options"
              aria-expanded=${this.focusOptionsOpen}
              aria-activedescendant=${this.focusOptionsOpen ? `focus-option-${this.focusOptionIndex}` : ''}
              placeholder=${this.focusOptionsOpen ? 'Search plans' : 'All plans'}
              .value=${this.focusOptionsOpen ? this.focusSearch :
                focusedProject ? focusedProject.name : ''}
              @click=${() => this._openFocusOptions()}
              @input=${(event) => {
                this.focusSearch = event.target.value;
                this.focusOptionIndex = this._focusOptions().length > 1 ? 1 : 0;
                this.focusOptionsOpen = true;
              }}
              @keydown=${this._onFocusKeydown} />
            <button type="button" class="focus-trigger" title="Show plans"
              @click=${(event) => {
                this._openFocusOptions();
                event.currentTarget.previousElementSibling.focus();
              }}></button>
          </div>
          ${this.focusOptionsOpen ? html`
            <div class="focus-options" id="connected-plan-options" role="listbox">
              ${options.map((project, index) => html`
                <button type="button" class="focus-option ${index === this.focusOptionIndex ? 'active' : ''}"
                  id="focus-option-${index}" role="option" data-plan-id=${project ? project.id : ''}
                  aria-selected=${project ? String(project.id) === this.focusedPlanId : !this.focusedPlanId}
                  @click=${() => this._chooseFocus(project)}>${project ? project.name : 'All plans'}</button>
              `)}
            </div>` : ''}
        </div>
        <div class="counts-header">
          <span></span>
          <div class="plan-actions">
          <button
            class="list-toggle-btn"
            @click=${this._handleProjectToggle}
            title=${this.focusedPlanId ? 'Select or clear displayed plans' : 'Select or clear all plans'}
          >
            ${this._anyUncheckedProjects() ? 'All' : 'None'}
          </button>
          ${this.focusedPlanId && this.projects.some((project) =>
            project.selected && !projects.includes(project)) ? html`
            <button type="button" class="list-toggle-btn clear-hidden-btn"
              title="Clear hidden plans"
              @click=${this._clearHiddenProjects}>Clear hidden</button>
          ` : ''}
          </div>
          ${taskTypes.map((key) => html`<span class="type-icon" title=${sel.feature.getTypeDisplayName(key)}
            >${getIconTemplate(sel.feature.getTypeDisplayName(key))}</span>`)}
        </div>

        <div class="plans-group">
          ${orderedGroups.map(([type, group], index) => html`
              ${index ? html`<div class="divider"></div>` : ''}
              <span class="group-label">${type}</span>
              <ul class="sidebar-list">
                ${this._renderProjectsList(group.projects, taskTypes, projectCounts)}
              </ul>
            `)}
        </div>
      </div>
    `;
  }
}

customElements.define('plan-menu', PlanMenuLit);
