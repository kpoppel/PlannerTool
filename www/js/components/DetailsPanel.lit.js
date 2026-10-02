import { LitElement, html } from '../vendor/lit.js';
import { DETAILS_PANEL_STYLES } from './details-panel/DetailsPanel.styles.lit.js';
import { bus } from '../core/EventBus.js';
import { UIEvents } from '../core/EventRegistry.js';
import { cmd, sel } from '../application/imports.js';
import { DetailsPanelController } from './details-panel/DetailsPanelController.js';
import { renderDetailsPanelHeader } from './details-panel/DetailsPanelHeader.lit.js';
import { renderDetailsPanelScheduling } from './details-panel/DetailsPanelScheduling.lit.js';
import { renderDetailsPanelCapacity } from './details-panel/DetailsPanelCapacity.lit.js';
import { parseDetailsPanelTags, renderDetailsPanelTags } from './details-panel/DetailsPanelTags.lit.js';
import { renderDetailsPanelRelations } from './details-panel/DetailsPanelRelations.lit.js';

export class DetailsPanelLit extends LitElement {
  static properties = {
    feature: { type: Object },
    open: { type: Boolean },
    iterations: { type: Array },
    editingCapacityTeam: { type: String, noAccessor: true },
    showAddTeamPopover: { type: Boolean, noAccessor: true },
  };

  static styles = DETAILS_PANEL_STYLES;

  constructor() {
    super();
    this._controller = new DetailsPanelController(this);
    this.feature = null;
    this.open = false;
    this.iterations = [];
    this.editingCapacityTeam = null; // Track which team pill is being edited
    this.showAddTeamPopover = false; // Track if add team popover is visible
    this.editingState = false;
    this._stateEditValue = null;
    this._newTagText = '';
  }

  get editingCapacityTeam() { return this._controller.editor.editingCapacityTeam; }
  set editingCapacityTeam(value) {
    this._controller.editor.editingCapacityTeam = value;
    this.requestUpdate();
  }
  get showAddTeamPopover() { return this._controller.editor.showAddTeamPopover; }
  set showAddTeamPopover(value) {
    this._controller.editor.showAddTeamPopover = value;
    this.requestUpdate();
  }
  get editingState() { return this._controller.editor.editingState; }
  set editingState(value) { this._controller.editor.editingState = value; }
  get _stateEditValue() { return this._controller.editor.stateEditValue; }
  set _stateEditValue(value) { this._controller.editor.stateEditValue = value; }
  get _newTagText() { return this._controller.editor.newTagText; }
  set _newTagText(value) { this._controller.editor.newTagText = value; }

  // Note: use component's shadow DOM (default) so component styles apply correctly

  /**
   * Strip [PlannerTool Team Capacity] block from description HTML for display.
   */
  _stripCapacityFromDescription(description) {
    if (!description) return '';
    // Remove the capacity block including HTML tags around it
    let cleaned = description.replace(
      /\[PlannerTool Team Capacity\][\s\S]*?\[\/PlannerTool Team Capacity\]/gi,
      ''
    );
    // Clean up extra whitespace and line breaks
    cleaned = cleaned.replace(/(<br\s*\/?>|\n){2,}/gi, '<br/>');
    cleaned = cleaned.trim();
    return cleaned;
  }

  _onFeatureUpdated(payload) {
    this._controller.refresh(payload);
  }

  _onShow() {
    this._controller.show();
  }

  _parseTags(tagsValue) {
    return parseDetailsPanelTags(tagsValue);
  }

  _normaliseTags(tagsValue) {
    return this._parseTags(tagsValue).map((tag) => tag.toLowerCase());
  }

  _tagsToString(tags) {
    return tags.join('; ');
  }

  _onTagInput(value) {
    this._newTagText = value;
  }

  _onTagInputKeydown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      this._addTag();
    }
  }

  _addTag() {
    if (!this.feature) return;
    const newTag = this._newTagText.trim().replace(/;+$/g, '');
    if (!newTag) return;
    const current = this._parseTags(this.feature.tags);
    const existingNorm = new Set(current.map((tag) => tag.toLowerCase()));
    if (!existingNorm.has(newTag.toLowerCase())) {
      current.push(newTag);
      cmd.feature.updateFeatureField(this.feature.id, 'tags', this._tagsToString(current));
    }
    this._newTagText = '';
    this.requestUpdate();
  }

  _removeTag(tagToRemove) {
    if (!this.feature) return;
    const removeNorm = String(tagToRemove).toLowerCase();
    const remaining = this._parseTags(this.feature.tags).filter(
      (tag) => tag.toLowerCase() !== removeNorm
    );
    cmd.feature.updateFeatureField(
      this.feature.id,
      'tags',
      remaining.length ? this._tagsToString(remaining) : null
    );
    this.requestUpdate();
  }

  _getChildIds(parentId) {
    const childrenByParent = sel.feature.getChildrenByParentMap();
    const ids = childrenByParent.get(String(parentId));
    return ids === undefined ? [] : ids;
  }

  async _shrinkwrapEpic(e) {
    e && e.stopPropagation();
    if (!this.feature) return;
    const f = this.feature;
    const { start, end } = this._controller.getChildDateBounds();
    if (start === null || end === null) return;
    cmd.feature.updateFeatureDates([{
      id: f.id,
      start,
      end,
      shiftChildren: false,
    }]);
  }

  /**
   * Snap only the start date to the earliest child start, keeping the current end.
   */
  _snapStartDate(e) {
    e && e.stopPropagation();
    if (!this.feature) return;
    const f = this.feature;
    const { start } = this._controller.getChildDateBounds();
    if (start === null) return;
    cmd.feature.updateFeatureDates([{
      id: f.id,
      start,
      end: f.end ? f.end : null,
      shiftChildren: false,
    }]);
  }

  /**
   * Snap only the end date to the latest child end, keeping the current start.
   */
  _snapEndDate(e) {
    e && e.stopPropagation();
    if (!this.feature) return;
    const f = this.feature;
    const { end } = this._controller.getChildDateBounds();
    if (end === null) return;
    cmd.feature.updateFeatureDates([{
      id: f.id,
      start: f.start ? f.start : null,
      end,
      shiftChildren: false,
    }]);
  }

  /**
   * Returns the iteration path whose dates exactly match the feature's current
   * start/end, or null if no iteration's bounds match (dates overridden).
   */
  _activeIterationPath(feature, iterations) {
    if (!feature || !feature.start || !feature.end || !iterations || !iterations.length) {
      return null;
    }
    const match = iterations.find(
      (it) =>
        it.startDate && it.finishDate &&
        it.startDate.slice(0, 10) === feature.start &&
        it.finishDate.slice(0, 10) === feature.end
    );
    return match ? match.path : null;
  }

  hide() {
    this._controller.resetEditors();
    this.open = false;
    this.requestUpdate();
    bus.emit(UIEvents.DETAILS_HIDE);
  }

  hideAndEmit() {
    // Close panel and emit a global hide event so other components can respond
    this.hide();
  }

  _handleCapacityClick(teamId, e) {
    e.stopPropagation();
    // Click on bar focuses the input
    const row = e.target.closest('.capacity-bar-row');
    if (row) {
      const input = row.querySelector('.capacity-bar-input');
      if (input) {
        input.focus();
        input.select();
      }
    }
  }

  _handleCapacityInputKeydown(teamId, e) {
    if (e.key === 'Enter') {
      this._saveCapacityEdit(teamId, e.target.value);
    } else if (e.key === 'Escape') {
      this.editingCapacityTeam = null;
      this.requestUpdate();
    }
  }

  _handleCapacityInputBlur(teamId, e) {
    this._saveCapacityEdit(teamId, e.target.value);
  }

  _saveCapacityEdit(teamId, newValue) {
    const parsed = parseInt(newValue, 10);
    const capacity = Number.isNaN(parsed) ? 0 : parsed;
    const clampedCapacity = Math.max(0, Math.min(100, capacity));

    // Create a new capacity array to avoid mutating the baseline
    if (this.feature && this.feature.capacity) {
      const newCapacity = this.feature.capacity.map((c) =>
        c.team === teamId ? { ...c, capacity: clampedCapacity } : { ...c }
      );
      // Store as override in the scenario
      cmd.feature.updateFeatureField(this.feature.id, 'capacity', newCapacity);
    }

    this.editingCapacityTeam = null;
    this.requestUpdate();
  }

  _handleDeleteCapacity(teamId, e) {
    if (this.feature && this.feature.capacity) {
      // Create a new capacity array without the deleted team
      const newCapacity = this.feature.capacity.filter((c) => c.team !== teamId);
      // Store as override in the scenario
      cmd.feature.updateFeatureField(this.feature.id, 'capacity', newCapacity);
      this.requestUpdate();
    }
  }

  _handleAddTeamClick(e) {
    this.showAddTeamPopover = !this.showAddTeamPopover;
    this.requestUpdate();
  }

  _handleAddTeamSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const teamSelect = form.querySelector('select');
    const capacityInput = form.querySelector('input');

    const teamId = teamSelect.value;
    this._addCapacityTeam(teamId, capacityInput.value);
  }

  _addCapacityTeam(teamId, value) {
    const parsed = parseInt(value, 10);
    const capacity = Number.isNaN(parsed) ? 0 : parsed;
    const clampedCapacity = Math.max(0, Math.min(100, capacity));

    if (teamId && this.feature) {
      // Check if team already exists
      const currentCapacity = this.feature.capacity;
      const existing = currentCapacity.find((c) => c.team === teamId);
      if (!existing) {
        // Create new array instead of mutating baseline
        const newCapacity = [
          ...currentCapacity,
          { team: teamId, capacity: clampedCapacity },
        ];
        // Store as override in the scenario
        cmd.feature.updateFeatureField(this.feature.id, 'capacity', newCapacity);
      }
    }

    this.showAddTeamPopover = false;
    this.requestUpdate();
  }

  _handleAddTeamCancel() {
    this.showAddTeamPopover = false;
    this.requestUpdate();
  }

  _onStateClick(e) {
    e && e.stopPropagation();
    if (!this.feature) return;
    this.editingState = true;
    this._stateEditValue = this.feature.state;
    this.requestUpdate();
    // focus select after render
    this._controller.defer(() => {
      // Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
      const select = this.shadowRoot.querySelector('.state-select');
      if (select instanceof HTMLSelectElement) {
        select.focus();
      }
    }, 10);
  }

  _onStateChange(e) {
    this._stateEditValue = e.target.value;
  }

  _onStateKeydown(e) {
    if (e.key === 'Enter') {
      this._saveStateEdit();
    } else if (e.key === 'Escape') {
      this.editingState = false;
      this.requestUpdate();
    }
  }

  _onStateBlur(e) {
    // small timeout to allow click to register
    this._controller.defer(() => {
      if (this.editingState) this._saveStateEdit();
    }, 150);
  }

  _saveStateEdit() {
    if (!this.feature) {
      this.editingState = false;
      this.requestUpdate();
      return;
    }
    const val = this._stateEditValue;
    if (val && val !== this.feature.state) {
      cmd.feature.updateFeatureField(this.feature.id, 'state', val);
    }
    this.editingState = false;
    this._stateEditValue = null;
    this.requestUpdate();
  }

  _onStateChipSelect(s) {
    if (!this.feature) return;
    if (s && s !== this.feature.state) {
      cmd.feature.updateFeatureField(this.feature.id, 'state', s);
    }
    this.editingState = false;
    this._stateEditValue = null;
    this.requestUpdate();
  }

  updated(changedProps) {
    if (changedProps.has('feature') || changedProps.has('open')) {
      // load iterations whenever the panel opens or the feature changes.
      // Checking 'open' ensures we reload when the same card is reopened after
      // the panel was closed — in that case 'feature' hasn't changed reference
      // so Lit would not flag it as changed.
      this._loadIterationsForFeature();
    }
  }

  async _loadIterationsForFeature() {
    return this._controller.loadIterations();
  }

  _formatIterationLabel(it) {
    if (!it) return '';
    const name = it.name ? it.name : this._stripIterationPrefix(it.path);
    const start = it.startDate ? it.startDate.slice(0, 10) : null;
    const end = it.finishDate ? it.finishDate.slice(0, 10) : null;

    if (start && end) {
      return `${name} (${start} to ${end})`;
    } else if (start) {
      return `${name} (from ${start})`;
    } else if (end) {
      return `${name} (until ${end})`;
    }
    return name;
  }

  _stripIterationPrefix(path) {
    if (!path || typeof path !== 'string') return path;
    const m = path.match(/^(.+?)\\Iteration\\(.+)$/);
    if (m) return m[2];
    return path;
  }

  _onStartDateChange(value) {
    const val = value === '' ? null : value;
    if (!this.feature) return;
    const end = this.feature.end ? this.feature.end : null;
    try {
      cmd.feature.updateFeatureDates([{ id: this.feature.id, start: val, end }]);
    } catch (err) {
      console.warn('Failed to update start date', err);
    }
  }

  _onEndDateChange(value) {
    const val = value === '' ? null : value;
    if (!this.feature) return;
    const start = this.feature.start ? this.feature.start : null;
    try {
      cmd.feature.updateFeatureDates([{ id: this.feature.id, start, end: val }]);
    } catch (err) {
      console.warn('Failed to update end date', err);
    }
  }

  _clearDates() {
    if (!this.feature) return;
    try {
      // Clearing dates fully unplans the task — the iteration preset is also
      // cleared because keeping a sprint label without any dates would be
      // contradictory ("iteration as quick-fill preset" paradigm).
      if (this.feature.iterationPath) {
        cmd.feature.updateFeatureField(this.feature.id, 'iterationPath', null);
      }
      cmd.feature.updateFeatureDates([{ id: this.feature.id, start: null, end: null }]);
    } catch (err) {
      console.warn('Failed to clear dates', err);
    }
  }

  async _onIterationChange(path) {
    if (!path) return;
    const it = this.iterations.find(
      (iteration) => iteration.path === path || iteration.path.endsWith(path)
    );
    if (!it) return;
    const start = it.startDate ? it.startDate.slice(0, 10) : null;
    const end = it.finishDate ? it.finishDate.slice(0, 10) : null;
    if (!this.feature) return;
    try {
      // Persist the iterationPath field first so it is included in the override
      cmd.feature.updateFeatureField(this.feature.id, 'iterationPath', path);
      // Then update dates (preserves iterationPath already stored in override)
      if (start && end) {
        cmd.feature.updateFeatureDates([{ id: this.feature.id, start, end }]);
      }
    } catch (err) {
      console.warn('Failed to update iteration', err);
    }
  }

  _renderField(label, field, value) {
    const original =
      this.feature && this.feature.original ? this.feature.original[field] : undefined;
    const changed = original !== undefined && value !== original;
    const cls = changed ? 'details-value details-changed' : 'details-value';
    const originalSpan =
      changed ?
        html` <span class="original-date" title="Original">(was ${original})</span>`
      : '';
    return html`<div class="details-label">${label}:</div>
      <div class="${cls}">${value == null || value === '' ? '—' : value}${originalSpan}</div>`;
  }

  render() {
    if (!this.open || !this.feature) return html`<div class="panel closed"></div>`;
    const feature = this.feature;
    const model = this._controller.getPresentationModel(new Date().toISOString().slice(0, 10));

    // Strip capacity section from description
    const cleanDescription = this._stripCapacityFromDescription(feature.description);
    const changedSet = new Set(feature.changedFields);
    const changedBanner =
      changedSet.size ?
        html`<div class="details-change-banner">
          ${html`<button
            class="details-revert"
            title="Revert changes"
            @click=${(ev) => {
              ev.stopPropagation();
              cmd.feature.revertFeature(feature.id);
            }}
          >
            ↺
          </button>`}
          Modified locally (${[...changedSet].join(', ')})
        </div>`
      : '';

    return html`
      <div class="panel">
        ${renderDetailsPanelHeader({
          model: model.header,
          actions: this._controller.bindActions({
            close: () => this.hide(),
            startStateEdit: () => this._onStateClick(),
            blurState: () => this._onStateBlur(),
            selectState: (value) => this._onStateChipSelect(value),
          }),
        })}
        <div class="details-content">
          ${this._renderField('Assignee', 'assignee', feature.assignee)}
          ${renderDetailsPanelScheduling({
            model: model.scheduling,
            actions: this._controller.bindActions({
              selectIteration: (path) => this._onIterationChange(path),
              changeStart: (value) => this._onStartDateChange(value),
              changeEnd: (value) => this._onEndDateChange(value),
              snapStart: () => this._snapStartDate(),
              snapEnd: () => this._snapEndDate(),
              fitChildren: () => this._shrinkwrapEpic(),
              clearDates: () => this._clearDates(),
            }),
          })}

          ${renderDetailsPanelCapacity({
            model: model.capacity,
            actions: this._controller.bindActions({
              changeCapacity: (teamId, value) => this._saveCapacityEdit(teamId, value),
              removeTeam: (teamId) => this._handleDeleteCapacity(teamId),
              toggleAddTeam: () => this._handleAddTeamClick(),
              addTeam: (teamId, value) => this._addCapacityTeam(teamId, value),
              cancelAddTeam: () => this._handleAddTeamCancel(),
              cancelEdit: () => {
                this.editingCapacityTeam = null;
                this.requestUpdate();
              },
            }),
          })}

          ${renderDetailsPanelTags({
            model: model.tags,
            actions: this._controller.bindActions({
              changeDraft: (value) => this._onTagInput(value),
              addTag: () => this._addTag(),
              removeTag: (tag) => this._removeTag(tag),
            }),
          })}

          <div class="details-label">Description</div>
          <div class="details-value" .innerHTML=${cleanDescription === '' ? '—' : cleanDescription}></div>
          ${renderDetailsPanelRelations({ model: model.relations })}
          ${changedBanner}
        </div>
      </div>
    `;
  }
}

customElements.define('details-panel', DetailsPanelLit);
