import { PopoverBase } from './PopoverBase.lit.js';
import { html, css } from '../../vendor/lit.js';
import { state, PALETTE } from '../../services/State.js';
import { bus } from '../../core/EventBus.js';
import { ProjectEvents } from '../../core/EventRegistry.js';
import { ColorPopoverLit } from '../ColorPopover.lit.js';
import { epicTemplate, featureTemplate } from '../../services/IconService.js';

/**
 * PlansPopover - Popover component for plan selection
 */
export class PlansPopover extends PopoverBase {
  static properties = {
    ...PopoverBase.properties,
    projects: { type: Array }
  };

  static styles = [
    PopoverBase.styles,
    css`
      .popover-container {
        min-width: 300px;
        max-width: 400px;
        background: #fff;
        color: #222;
        border: 1px solid rgba(0,0,0,0.12);
        box-shadow: 0 6px 18px rgba(0,0,0,0.18);
      }

      .group-section {
        margin-bottom: 12px;
      }

      .group-section:last-child {
        margin-bottom: 0;
      }

      .group-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
        padding: 4px 8px;
        background: rgba(0, 0, 0, 0.04);
        border-radius: 4px;
      }

      .group-title {
        font-weight: 600;
        font-size: 13px;
        flex: 1;
        color: #222;
      }

      .toggle-button {
        background: #f7f7f7;
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 4px;
        padding: 4px 10px;
        color: #222;
        cursor: pointer;
        font-size: 12px;
        transition: background 0.2s;
      }

      .toggle-button:hover {
        background: #ececec;
      }

      .counts-header {
        display: grid;
        grid-template-columns: 16px 1fr 31px 31px;
        align-items: center;
        gap: 8px;
        padding: 4px 8px;
        color: #666;
        font-size: 12px;
        margin-bottom: 2px;
      }

      .plan-item {
        display: grid;
        grid-template-columns: 16px 1fr 31px 31px;
        align-items: center;
        padding: 6px 8px;
        cursor: pointer;
        border-radius: 4px;
        transition: background 0.2s;
        gap: 8px;
        margin: 0 4px;
        color: #222;
      }

      .plan-item:hover {
        background: #f3f5f7;
      }

      .plan-item.active {
        background: #e8f0fe;
        font-weight: 600;
      }

      .color-dot {
        width: 16px;
        height: 16px;
        border-radius: 4px;
        flex: 0 0 auto;
        cursor: pointer;
      }

      .plan-name {
        flex: 1;
        font-size: 14px;
        color: #222;
      }

      .team-short {
        font-size: 12px;
        color: #666;
      }

      .badge-group {
        display: contents;
      }

      .chip-badge {
        padding: 2px 6px;
        border-radius: 10px;
        font-size: 11px;
        background: rgba(0, 0, 0, 0.08);
        color: #222;
        white-space: nowrap;
        text-align: center;
        min-width: 22px;
      }

      .count-icons {
        display: flex;
        gap: 4px;
      }

      .type-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .type-icon.epic {
        color: #ffcf33;
      }

      .type-icon.feature {
        color: #5cc8ff;
      }

      .type-icon svg {
        width: 14px;
        height: 14px;
        display: block;
      }

      .divider {
        border-top: 1px dashed rgba(0, 0, 0, 0.12);
        margin: 8px 0;
        height: 0;
      }

      .empty-state {
        padding: 16px;
        text-align: center;
        color: #666;
        font-size: 13px;
      }
    `
  ];

  constructor() {
    super();
    this.projects = [];
    this._onProjectsChanged = this._onProjectsChanged.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    bus.on(ProjectEvents.CHANGED, this._onProjectsChanged);
    this._loadProjects();
  }

  disconnectedCallback() {
    bus.off(ProjectEvents.CHANGED, this._onProjectsChanged);
    super.disconnectedCallback();
  }

  _onProjectsChanged() {
    this._loadProjects();
  }

  _loadProjects() {
    this.projects = state.projects || [];
    this.requestUpdate();
  }

  _toggleProject(projectId) {
    const current = this.projects.find(p => p.id === projectId);
    const newVal = !(current && current.selected);
    state.setProjectSelected(projectId, newVal);
  }

  _toggleAllInGroup(groupProjects, selectAll) {
    const selections = groupProjects.reduce((acc, p) => {
      acc[p.id] = selectAll;
      return acc;
    }, {});
    state.setProjectsSelectedBulk(selections);
  }

  async _openColorPopover(e, projectId) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const cp = await ColorPopoverLit.ensureInstance(PALETTE);
    await cp.updateComplete;
    cp.openFor('project', projectId, rect);
  }

  _renderPlanItem(project) {
    const epicsCount = state.countEpicsForProject(project.id);
    const featuresCount = state.countFeaturesForProject(project.id);

    return html`
      <div
        class="plan-item ${project.selected ? 'active' : ''}"
        @click=${e => {
          if (!e.target.closest('.color-dot')) {
            this._toggleProject(project.id);
          }
        }}>
        <span
          class="color-dot"
          style="background: ${project.color}"
          @click=${e => this._openColorPopover(e, project.id)}
          title="Change color"></span>
        <span class="plan-name" title="${project.name}">
          ${project.name}
        </span>
        <span class="chip-badge">${epicsCount}</span>
        <span class="chip-badge">${featuresCount}</span>
      </div>
    `;
  }

  _renderGroup(title, groupProjects) {
    if (!groupProjects || groupProjects.length === 0) {
      return html``;
    }

    const anyUnchecked = groupProjects.some(p => !p.selected);
    const allChecked = groupProjects.every(p => p.selected);

    return html`
      <div class="group-section">
        <div class="group-header">
          <span class="group-title">${title}</span>
          <button
            class="toggle-button"
            @click=${() => this._toggleAllInGroup(groupProjects, anyUnchecked)}
            title="${anyUnchecked ? 'Select all' : 'Clear all'}">
            ${anyUnchecked ? 'All' : 'None'}
          </button>
        </div>
        <div class="counts-header">
          <span></span>
          <span></span>
          <span class="type-icon epic" title="Epics">${epicTemplate}</span>
          <span class="type-icon feature" title="Features">${featureTemplate}</span>
        </div>
        <div class="group-items">
          ${groupProjects.map(p => this._renderPlanItem(p))}
        </div>
      </div>
    `;
  }

  renderContent() {
    if (!this.projects || this.projects.length === 0) {
      return html`
        <div class="empty-state">
          No plans available
        </div>
      `;
    }

    const deliveryPlans = this.projects.filter(p => (p.type || 'project') === 'project');
    const teamBacklogs = this.projects.filter(p => (p.type || 'project') !== 'project');

    return html`
      ${this._renderGroup('Delivery Plans', deliveryPlans)}
      ${deliveryPlans.length > 0 && teamBacklogs.length > 0 ? html`<div class="divider"></div>` : ''}
      ${this._renderGroup('Team Backlogs', teamBacklogs)}
    `;
  }
}

customElements.define('plans-popover', PlansPopover);
