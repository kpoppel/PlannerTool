import { LitElement, html } from '../vendor/lit.js';
import { DETAILS_PANEL_STYLES } from './details-panel/DetailsPanel.styles.lit.js';
import { bus } from '../core/EventBus.js';
import { UIEvents, FeatureEvents, ProjectEvents, TeamEvents } from '../core/EventRegistry.js';
import { cmd, sel } from '../application/imports.js';
import { renderDetailsPanelHeader } from './details-panel/DetailsPanelHeader.lit.js';
import {
  buildDetailsPanelSchedulingModel,
  renderDetailsPanelScheduling,
} from './details-panel/DetailsPanelScheduling.lit.js';
import {
  buildDetailsPanelCapacityModel,
  renderDetailsPanelCapacity,
} from './details-panel/DetailsPanelCapacity.lit.js';
import { renderDetailsPanelTags } from './details-panel/DetailsPanelTags.lit.js';
import {
  buildDetailsPanelRelationsModel,
  renderDetailsPanelRelations,
} from './details-panel/DetailsPanelRelations.lit.js';

/**
 * Azure DevOps state category → CSS background-color mapping.
 * Categories: Proposed | InProgress | Resolved | Completed | Removed
 */
const CATEGORY_COLORS = {
  Proposed:   '#f3f4f6',   // light gray   — not started
  InProgress: '#dbeafe',   // light blue   — active work
  Resolved:   '#fef3c7',   // light amber  — awaiting validation
  Completed:  '#dcfce7',   // light green  — done
  Removed:    '#fee2e2',   // light rose   — discarded
};

export class DetailsPanelLit extends LitElement {
  static properties = {
    feature: { type: Object },
    open: { type: Boolean },
    iterations: { type: Array },
    editingCapacityTeam: { type: String },
    showAddTeamPopover: { type: Boolean },
  };

  static styles = DETAILS_PANEL_STYLES;

  constructor() {
    super();
    this.feature = null;
    this.open = false;
    this.iterations = [];
    this.editingCapacityTeam = null; // Track which team pill is being edited
    this.showAddTeamPopover = false; // Track if add team popover is visible
    this.editingState = false;
    this._stateEditValue = null;
    this._newTagText = '';
    this._onShow = this._onShow.bind(this);
    this._onFeatureUpdatedBound = this._onFeatureUpdated.bind(this);
    this._onCapacityUpdatedBound = this._onCapacityUpdated.bind(this);
    this._onProjectsChangedBound = this._onProjectsChanged.bind(this);
    this._onTeamsChangedBound = this._onTeamsChanged.bind(this);
  }

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

  connectedCallback() {
    super.connectedCallback();
    bus.on(UIEvents.DETAILS_SHOW, this._onShow);
    bus.on(FeatureEvents.SELECTED, this._onShow);
    bus.on(FeatureEvents.UPDATED, this._onFeatureUpdatedBound);
    bus.on(FeatureEvents.CAPACITY_UPDATED, this._onCapacityUpdatedBound);
    bus.on(ProjectEvents.CHANGED, this._onProjectsChangedBound);
    bus.on(TeamEvents.CHANGED, this._onTeamsChangedBound);
    //TODO: Should the side panel receive update if it is shown and the feature is changed?
    //TODO: Should standardise what is sent on events (full feature vs id only)

    // Record mousedown when it starts on <feature-board>, compare on click.
    this._boardMouseDown = null;
    this._onBodyMouseDown = (e) => {
      // Record mousedown when it starts on the board area or feature-board
      // Use composedPath() to detect shadow-root-hosted elements like #board-area
      try {
        const path = e.composedPath ? e.composedPath() : [e.target];
        const hit = path.find((n) => {
          if (!n || !n.tagName) return false;
          if (n.tagName && n.tagName.toLowerCase() === 'feature-board') return true;
          if (n.id && n.id === 'board-area') return true;
          return false;
        });
        if (hit) this._boardMouseDown = { x: e.clientX, y: e.clientY };
      } catch (err) {
        if (e.target?.tagName?.toLowerCase() === 'feature-board') {
          this._boardMouseDown = { x: e.clientX, y: e.clientY };
        }
      }
    };

    this._onBodyClick = (e) => {
      // Noop if panel not open
      if (!this.open) return;
      // If the board did not move since mouseDown, close the panel.
      if (
        this._boardMouseDown &&
        this._boardMouseDown.x == e.x &&
        this._boardMouseDown.y == e.y
      ) {
        this.hide();
      }
    };

    document.body.addEventListener('mousedown', this._onBodyMouseDown);
    document.body.addEventListener('click', this._onBodyClick);
  }

  async _onCapacityUpdated(data) {
    const { featureId, capacity } = data;
    if (!featureId || !capacity) return;

    try {
      // Extract the numeric work item ID from the feature ID
      // Feature IDs are typically in format like "J_688051" or just the number
      const workItemId = String(featureId).replace(/^[A-Za-z_]+/, '');

      // Import dataService dynamically to avoid circular dependencies
      const { dataService } = await import('../services/dataService.js');

      // Call the API to update capacity in Azure DevOps
      const result = await dataService.updateWorkItemCapacity(workItemId, capacity);

      if (!result.ok) {
        console.error('Failed to update capacity:', result.error);
        // TODO: Show user-facing error notification
      } else {
        console.log('Successfully updated capacity for work item', workItemId);
      }
    } catch (error) {
      console.error('Error updating capacity:', error);
      // TODO: Show user-facing error notification
    }
  }

  _onFeatureUpdated(payload) {
    // Refresh feature data if the currently displayed feature was updated
    if (!this.open || !this.feature) return;

    const ids = payload?.ids;
    const isGlobalRefresh = !Array.isArray(ids);
    const currentId = String(this.feature.id);
    const normalizedIds = Array.isArray(ids) ? ids.map((id) => String(id)) : [];
    if (isGlobalRefresh || normalizedIds.includes(currentId)) {
      // Get fresh feature data from state
      const updated = sel.feature.getEffectiveFeatureById(this.feature.id);
      if (updated) {
        this.feature = updated;
        this._loadIterationsForFeature();
        this.requestUpdate();
      }
    }
  }

  _onProjectsChanged() {
    // Iteration groups are keyed by configured project id and can change after
    // baseline/admin refreshes; when panel is open, reload options for current feature.
    if (!this.open || !this.feature) return;
    this._loadIterationsForFeature();
  }

  _onTeamsChanged() {
    // orgLoad is derived from the team selection, so re-read the projected feature.
    if (!this.open || !this.feature) return;
    const updated = sel.feature.getEffectiveFeatureById(this.feature.id);
    if (!updated) return;
    this.feature = updated;
    this.requestUpdate();
  }

  disconnectedCallback() {
    bus.off(UIEvents.DETAILS_SHOW, this._onShow);
    bus.off(FeatureEvents.SELECTED, this._onShow);
    bus.off(FeatureEvents.UPDATED, this._onFeatureUpdatedBound);
    bus.off(FeatureEvents.CAPACITY_UPDATED, this._onCapacityUpdatedBound);
    bus.off(ProjectEvents.CHANGED, this._onProjectsChangedBound);
    bus.off(TeamEvents.CHANGED, this._onTeamsChangedBound);
    document.body.removeEventListener('mousedown', this._onBodyMouseDown);
    document.body.removeEventListener('click', this._onBodyClick);
    super.disconnectedCallback();
  }

  _onShow() {
    const feature = sel.feature.getSelectedFeature();
    if (!feature) return;
    this.feature = feature;
    this._newTagText = '';
    this.open = true;
    this.requestUpdate();
  }

  _parseTags(tagsValue) {
    if (!tagsValue || typeof tagsValue !== 'string') return [];
    return tagsValue
      .split(';')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  _normaliseTags(tagsValue) {
    return this._parseTags(tagsValue).map((tag) => tag.toLowerCase());
  }

  _tagsToString(tags) {
    return (tags || []).join('; ');
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
    const newTag = (this._newTagText || '').trim().replace(/;+$/g, '');
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
    const removeNorm = String(tagToRemove || '').toLowerCase();
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
    if (!(childrenByParent instanceof Map)) return [];
    const key = String(parentId);
    return childrenByParent.get(key) || childrenByParent.get(parentId) || [];
  }

  async _shrinkwrapEpic(e) {
    e && e.stopPropagation();
    if (!this.feature) return;
    const f = this.feature;
    // shrinkwrap applies to any parent item (has children in the hierarchy)
    const childIds = this._getChildIds(f.id);
    if (!childIds || !childIds.length) return;

    // Use effective feature dates (respecting active scenario overrides)
    let minStartMs = null;
    let maxEndMs = null;
    for (const cid of childIds) {
      const eff = sel.feature.getEffectiveFeatureById(cid);
      if (!eff) continue;
      const s = eff.start;
      const e = eff.end;
      if (s) {
        const sMs = Date.parse(s);
        if (!isNaN(sMs) && (minStartMs === null || sMs < minStartMs)) minStartMs = sMs;
      }
      if (e) {
        const eMs = Date.parse(e);
        if (!isNaN(eMs) && (maxEndMs === null || eMs > maxEndMs)) maxEndMs = eMs;
      }
    }
    if (minStartMs === null || maxEndMs === null) return;

    const toIsoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
    const newStart = toIsoDate(minStartMs);
    const newEnd = toIsoDate(maxEndMs);

    // Use state.updateFeatureDates to update both start and end together
    cmd.feature.updateFeatureDates([{
      id: f.id,
      start: newStart,
      end: newEnd,
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
    const childIds = this._getChildIds(f.id);
    if (!childIds || !childIds.length) return;
    let minStartMs = null;
    for (const cid of childIds) {
      const eff = sel.feature.getEffectiveFeatureById(cid);
      if (!eff || !eff.start) continue;
      const ms = Date.parse(eff.start);
      if (!isNaN(ms) && (minStartMs === null || ms < minStartMs)) minStartMs = ms;
    }
    if (minStartMs === null) return;
    const newStart = new Date(minStartMs).toISOString().slice(0, 10);
    const currentEnd = f.end || null;
    cmd.feature.updateFeatureDates([{
      id: f.id,
      start: newStart,
      end: currentEnd,
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
    const childIds = this._getChildIds(f.id);
    if (!childIds || !childIds.length) return;
    let maxEndMs = null;
    for (const cid of childIds) {
      const eff = sel.feature.getEffectiveFeatureById(cid);
      if (!eff || !eff.end) continue;
      const ms = Date.parse(eff.end);
      if (!isNaN(ms) && (maxEndMs === null || ms > maxEndMs)) maxEndMs = ms;
    }
    if (maxEndMs === null) return;
    const newEnd = new Date(maxEndMs).toISOString().slice(0, 10);
    const currentStart = f.start || null;
    cmd.feature.updateFeatureDates([{
      id: f.id,
      start: currentStart,
      end: newEnd,
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
    this.open = false;
    this.requestUpdate();
    bus.emit(UIEvents.DETAILS_HIDE);
  }

  hideAndEmit() {
    // Close panel and emit a global hide event so other components can respond
    this.open = false;
    this.requestUpdate();
    bus.emit(UIEvents.DETAILS_HIDE);
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
    const capacity = parseInt(newValue) || 0;
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
    this._stateEditValue = this.feature.state || '';
    this.requestUpdate();
    // focus select after render
    setTimeout(() => {
      const sel = this.shadowRoot && this.shadowRoot.querySelector('.state-select');
      if (sel) {
        sel.focus();
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
    setTimeout(() => {
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
    if (changedProps.has && (changedProps.has('feature') || changedProps.has('open'))) {
      // load iterations whenever the panel opens or the feature changes.
      // Checking 'open' ensures we reload when the same card is reopened after
      // the panel was closed — in that case 'feature' hasn't changed reference
      // so Lit would not flag it as changed.
      this._loadIterationsForFeature();
    }
  }

  async _loadIterationsForFeature() {
    try {
      const f = this.feature;
      if (!f) {
        this.iterations = [];
        return;
      }

      const projectId = f.project ? String(f.project).trim() : '';
      this.iterations = sel.feature.getIterationsForProject(projectId);
      // Lit's property-binding diff skips re-setting `.value` on the <select>
      // when `selectedPath` hasn't changed between renders (same card reopened).
      // Waiting for updateComplete ensures <option> elements exist, then we
      // imperatively sync the select value to bypass Lit's stale cache.
      await this.updateComplete;
      const iterationSelect = this.shadowRoot?.querySelector('.iteration-select');
      if (iterationSelect) iterationSelect.value = f.iterationPath || '';
    } catch (e) {
      console.warn('Failed to load iterations from selectors', e);
    }
  }

  _formatIterationLabel(it) {
    if (!it) return '';
    const name = it.name || this._stripIterationPrefix(it.path);
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
    const end = this.feature.end || null;
    try {
      cmd.feature.updateFeatureDates([{ id: this.feature.id, start: val, end }]);
    } catch (err) {
      console.warn('Failed to update start date', err);
    }
  }

  _onEndDateChange(value) {
    const val = value === '' ? null : value;
    if (!this.feature) return;
    const start = this.feature.start || null;
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
      <div class="${cls}">${value || '—'}${originalSpan}</div>`;
  }

  render() {
    if (!this.open || !this.feature) return html`<div class="panel closed"></div>`;
    const feature = this.feature;
    const projects = sel.selection.getProjects();
    const teams = sel.selection.getTeams();
    const childrenByParent = sel.feature.getChildrenByParentMap();
    const stateColors = sel.filter.getFeatureStateColors();
    const availableFeatureStates = sel.filter.getAvailableFeatureStates();
    const stateOrig = feature && feature.original ? feature.original.state : undefined;
    const stateChanged = stateOrig !== undefined && feature.state !== stateOrig;
    const planObj = projects.find((p) => p.id === feature.project);
    const planName = planObj ? planObj.name : null;

    const capacityModel = buildDetailsPanelCapacityModel({
      capacity: feature.capacity,
      orgLoad: feature.orgLoad,
      teams,
      showAddTeamPopover: this.showAddTeamPopover,
    });
    const schedulingModel = buildDetailsPanelSchedulingModel({
      feature,
      iterations: this.iterations,
      childrenByParent,
      orig: feature.original,
      today: new Date().toISOString().slice(0, 10),
    });

    // Strip capacity section from description
    const cleanDescription = this._stripCapacityFromDescription(feature.description);
    const parsedTags = this._parseTags(feature.tags);
    const tagsOrig = feature && feature.original ? feature.original.tags : undefined;
    const tagsChanged = tagsOrig !== undefined &&
      JSON.stringify(this._normaliseTags(feature.tags)) !==
        JSON.stringify(this._normaliseTags(tagsOrig));

    const changedSet = new Set(feature.changedFields || []);
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

    const linkedFeatures = new Map();
    const stateCategories = new Map();
    for (const relation of feature.relations) {
      const id = String(relation.id);
      const linked = sel.feature.getBaselineFeatureById(id);
      if (linked) {
        linkedFeatures.set(id, linked);
        stateCategories.set(linked.state, sel.filter.getFeatureStateCategory(linked.state));
      }
    }
    const relationsModel = buildDetailsPanelRelationsModel({
      relations: feature.relations,
      projectId: feature.project,
      featureUrl: feature.url,
      projects,
      linkedFeatures,
      stateColors,
      stateCategories,
    });

    return html`
      <div class="panel">
        ${renderDetailsPanelHeader({
          model: {
            feature, planName, stateChanged, originalState: stateOrig,
            stateColors, availableFeatureStates,
            editingState: this.editingState, stateEditValue: this._stateEditValue,
          },
          actions: {
            close: () => this.hide(),
            startStateEdit: () => this._onStateClick(),
            blurState: () => this._onStateBlur(),
            selectState: (value) => this._onStateChipSelect(value),
          },
        })}
        <div class="details-content">
          ${this._renderField('Assignee', 'assignee', feature.assignee)}
          ${renderDetailsPanelScheduling({
            model: schedulingModel,
            actions: {
              selectIteration: (path) => this._onIterationChange(path),
              changeStart: (value) => this._onStartDateChange(value),
              changeEnd: (value) => this._onEndDateChange(value),
              snapStart: () => this._snapStartDate(),
              snapEnd: () => this._snapEndDate(),
              fitChildren: () => this._shrinkwrapEpic(),
              clearDates: () => this._clearDates(),
            },
          })}

          ${renderDetailsPanelCapacity({
            model: capacityModel,
            actions: {
              changeCapacity: (teamId, value) => this._saveCapacityEdit(teamId, value),
              removeTeam: (teamId) => this._handleDeleteCapacity(teamId),
              toggleAddTeam: () => this._handleAddTeamClick(),
              addTeam: (teamId, value) => this._addCapacityTeam(teamId, value),
              cancelAddTeam: () => this._handleAddTeamCancel(),
              cancelEdit: () => {
                this.editingCapacityTeam = null;
                this.requestUpdate();
              },
            },
          })}

          ${renderDetailsPanelTags({
            model: {
              tags: parsedTags, changed: tagsChanged, originalTags: tagsOrig,
              newTagText: this._newTagText,
            },
            actions: {
              changeDraft: (value) => this._onTagInput(value),
              addTag: () => this._addTag(),
              removeTag: (tag) => this._removeTag(tag),
            },
          })}

          <div class="details-label">Description</div>
          <div class="details-value" .innerHTML=${cleanDescription || '—'}></div>
          ${renderDetailsPanelRelations({ model: relationsModel })}
          ${changedBanner}
        </div>
      </div>
    `;
  }
}

customElements.define('details-panel', DetailsPanelLit);
