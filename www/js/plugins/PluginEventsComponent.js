/**
 * PluginEventsComponent - Displays locally-stored plan events as a timeline overlay.
 *
 * Events are rendered at the TOP of the SVG board area (same zone as markers).
 * When the markers plugin is also active, event tags are offset downward by one
 * tag height + gap so the two rows do not overlap.
 * Tags stack further downward for clustered dates on the same X position.
 *
 * The floating toolbar provides full per-plan event management (add / edit / delete)
 * for every plan that is currently active in the plan filter.
 */
import { html, css } from '../vendor/lit.js';
import { OverlaySvgPlugin } from './OverlaySvgPlugin.js';
import { findInBoard } from '../components/board-utils.js';
import { boardCoords } from '../services/BoardCoordinateService.js';
import { TIMELINE_CONFIG, getTimelineMonths } from '../components/Timeline.lit.js';
import { bus } from '../core/EventBus.js';
import {
  TimelineEvents,
  ProjectEvents,
  PlanEventEvents,
  PluginEvents,
  BoardEvents,
} from '../core/EventRegistry.js';
import { dataService } from '../services/dataService.js';
import { state } from '../services/State.js';
import { pluginManager } from '../core/PluginManager.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Minimum pixel gap between two tag centres before stacking downward. */
const TAG_CLUSTER_THRESHOLD = 60;
const TAG_HEIGHT = 18;

export class PluginEventsComponent extends OverlaySvgPlugin {
  static overlayClass = 'events-overlay-svg';
  static zIndex = '124'; // just below markers (125)

  static properties = {
    events: { type: Array },
    categories: { type: Array },
    loading: { type: Boolean },
    _editId: { type: String, state: true },
    _editDate: { type: String, state: true },
    _editEndDate: { type: String, state: true },
    _editTitle: { type: String, state: true },
    _editPlanId: { type: String, state: true },
    _editCategory: { type: String, state: true },
    _newDates: { type: Object, state: true },
    _newEndDates: { type: Object, state: true },
    _newTitles: { type: Object, state: true },
    _newCategories: { type: Object, state: true },
    _saving: { type: Boolean, state: true },
    _addOpenPlanIds: { type: Object, state: true },
    _hiddenCategories: { type: Object, state: true },
    _editCatId: { type: String, state: true },
    _editCatName: { type: String, state: true },
    _newCatName: { type: String, state: true },
    _catSaving: { type: Boolean, state: true },
  };

  constructor() {
    super();
    this.events = [];
    this.categories = [];
    this.loading = false;
    this._editId = null;
    this._editDate = '';
    this._editEndDate = '';
    this._editTitle = '';
    this._editPlanId = '';
    this._editCategory = '';
    this._newDates = {};
    this._newEndDates = {};
    this._newTitles = {};
    this._newCategories = {};
    this._saving = false;
    this._addOpenPlanIds = {}; // tracks which plan add-rows are expanded
    this._hiddenCategories = {};
    this._editCatId = null;
    this._editCatName = '';
    this._newCatName = '';
    this._catSaving = false;
  }

  static styles = css`
    :host {
      display: none;
      position: fixed;
      z-index: 200;
      pointer-events: none;
    }

    :host([visible]) {
      display: block;
    }

    .floating-toolbar {
      position: fixed;
      top: 80px;
      right: 20px;
      background: white;
      padding: 12px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      pointer-events: auto;
      z-index: 200;
      width: 300px;
      box-sizing: border-box;
    }

    /* Inner scrollable content so header (with close) stays fixed */
    .floating-content {
      max-height: 70vh;
      overflow-y: auto;
      margin-top: 8px;
      box-sizing: border-box;
      padding-right: 6px; /* avoid clipping scrollbars */
    }

    .toolbar-title {
      font-size: 12px;
      font-weight: 600;
      color: #666;
      margin-bottom: 10px;
      text-transform: uppercase;
      padding-right: 24px;
    }

    .close-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 24px;
      height: 24px;
      padding: 0;
      background: transparent;
      border: none;
      color: #999;
      font-size: 16px;
      cursor: pointer;
      border-radius: 4px;
    }

    .close-btn:hover {
      color: #333;
      background: #f0f0f0;
    }

    .loading-msg {
      font-size: 12px;
      color: #999;
      padding: 4px 0 8px;
    }

    .no-plans-msg {
      font-size: 12px;
      color: #aaa;
      padding: 4px 0;
    }

    /* ---- per-plan section ---- */

    .plan-section {
      border-bottom: 1px solid #eee;
      padding-bottom: 8px;
      margin-bottom: 8px;
    }

    .plan-section:last-child {
      border-bottom: none;
      margin-bottom: 0;
    }

    .plan-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }

    .plan-color-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex: 0 0 10px;
    }

    .plan-name {
      font-size: 12px;
      font-weight: 700;
      color: #333;
      flex: 1;
    }

    .event-count-badge {
      font-size: 10px;
      background: #e3f2fd;
      color: #1565c0;
      padding: 1px 5px;
      border-radius: 8px;
    }

    .add-toggle-btn {
      background: transparent;
      border: 1px solid #aaa;
      border-radius: 50%;
      width: 16px;
      height: 16px;
      padding: 0;
      cursor: pointer;
      font-size: 12px;
      line-height: 14px;
      color: #666;
      flex: 0 0 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .add-toggle-btn:hover {
      background: #e3f2fd;
      border-color: #5481e6;
      color: #1565c0;
    }

    /* ---- event rows ---- */

    .event-row {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 0;
    }

    .event-date {
      font-size: 10px;
      color: #888;
      min-width: 74px;
      flex: 0 0 74px;
    }

    .event-title {
      font-size: 11px;
      color: #333;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .icon-btn {
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 1px 4px;
      color: #aaa;
      border-radius: 3px;
      font-size: 12px;
      line-height: 1;
    }

    .icon-btn:hover { color: #333; background: #f0f0f0; }
    .icon-btn.delete:hover { color: #c62828; }

    /* ---- inline edit form ---- */

    .edit-row {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 4px 0;
    }

    .edit-row input,
    .edit-row select {
      font-size: 11px;
      padding: 3px 5px;
      border: 1px solid #ccc;
      border-radius: 3px;
      width: 100%;
      box-sizing: border-box;
    }

    .edit-row input:focus,
    .edit-row select:focus {
      outline: none;
      border-color: #5481e6;
    }

    .edit-actions {
      display: flex;
      gap: 4px;
      justify-content: flex-end;
    }

    /* ---- buttons ---- */

    .btn {
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
      padding: 3px 8px;
    }

    .btn.save { background: #3a5aad; color: #fff; }
    .btn.save:hover { background: #5481e6; }
    .btn.save:disabled { background: #aaa; cursor: default; }
    .btn.cancel { background: #f0f0f0; color: #555; }
    .btn.cancel:hover { background: #e0e0e0; }

    /* ---- add new event row ---- */

    .add-row {
      display: flex;
      gap: 4px;
      margin-top: 4px;
      flex-wrap: wrap;
    }

    .add-row input {
      font-size: 11px;
      padding: 3px 5px;
      border: 1px solid #ccc;
      border-radius: 3px;
      box-sizing: border-box;
    }

    .add-row input[type='date'] { flex: 0 0 110px; }
    .add-row input[type='text'] { flex: 1; min-width: 80px; }
    .add-row input:focus { outline: none; border-color: #5481e6; }

    .add-btn {
      background: #3a5aad;
      color: #fff;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
      padding: 3px 8px;
      flex: 0 0 auto;
    }

    .add-btn:hover { background: #5481e6; }
    .add-btn:disabled { background: #aaa; cursor: default; }

    .empty-msg {
      font-size: 11px;
      color: #bbb;
      font-style: italic;
      padding: 2px 0;
    }

    .section-header {
      font-size: 11px;
      font-weight: 700;
      color: #555;
      text-transform: uppercase;
      padding: 4px 0 2px;
      border-bottom: 1px solid #eee;
      margin-bottom: 4px;
    }

    .section-subtitle {
      font-size: 10px;
      font-weight: 400;
      color: #999;
      text-transform: none;
      margin-left: 4px;
    }

    .cat-row {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 0;
    }

    .cat-name {
      font-size: 11px;
      color: #333;
      flex: 1;
      padding: 6px 8px;
      border-radius: 6px;
      cursor: pointer;
      user-select: none;
      transition: background 120ms ease, color 120ms ease;
    }

    .cat-name.visible {
      background: rgb(55, 85, 130);
      color: #fff;
    }

    .cat-name:hover { background: rgba(55,85,130,0.08); color: #000; }

    .star-btn {
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 1px 4px;
      font-size: 13px;
      line-height: 1;
      border-radius: 3px;
    }

    .star-btn.active { color: #f59e0b; }
    .star-btn:not(.active) { color: #ccc; }
    .star-btn:hover { color: #f59e0b; background: #fef3c7; }

    .filter-section {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 4px 0;
    }

    .filter-badge {
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 10px;
      border: 1px solid #aaa;
      cursor: pointer;
      background: #f5f5f5;
      color: #555;
      user-select: none;
    }

    .filter-badge.hidden {
      background: #fff;
      color: #aaa;
      text-decoration: line-through;
      border-color: #ddd;
    }

    .filter-badge:hover {
      background: #e3f2fd;
      border-color: #5481e6;
      color: #1565c0;
    }
  `;

  // ---------------------------------------------------------------------------
  // Bus subscriptions
  // ---------------------------------------------------------------------------

  _subscribeBusEvents() {
    this._timelineListener = () => this._scheduleRender();
    this._selectionListener = () => {
      this._scheduleRender();
      this.requestUpdate();
    };
    this._eventsChangedListener = () => this.refresh();
    // Re-render SVG when markers plugin activates/deactivates (affects Y offset)
    this._pluginStateListener = () => this._scheduleRender();

    bus.on(TimelineEvents.MONTHS_CHANGED, this._timelineListener);
    bus.on(TimelineEvents.SCALE_CHANGED, this._timelineListener);
    bus.on(ProjectEvents.CHANGED, this._selectionListener);
    bus.on(PlanEventEvents.CHANGED, this._eventsChangedListener);
    bus.on(PluginEvents.ACTIVATED, this._pluginStateListener);
    bus.on(PluginEvents.DEACTIVATED, this._pluginStateListener);
  }

  _unsubscribeBusEvents() {
    if (this._timelineListener) {
      bus.off(TimelineEvents.MONTHS_CHANGED, this._timelineListener);
      bus.off(TimelineEvents.SCALE_CHANGED, this._timelineListener);
    }
    if (this._selectionListener) bus.off(ProjectEvents.CHANGED, this._selectionListener);
    if (this._eventsChangedListener) bus.off(PlanEventEvents.CHANGED, this._eventsChangedListener);
    if (this._pluginStateListener) {
      bus.off(PluginEvents.ACTIVATED, this._pluginStateListener);
      bus.off(PluginEvents.DEACTIVATED, this._pluginStateListener);
    }
  }

  updated(changedProperties) {
    if (changedProperties.has('events')) {
      this._renderSvg();
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async open() {
    super.open();
    await this.refresh();
  }

  _handleClose() {
    // Deactivate via PluginManager to ensure global state and bus events
    // are emitted so the ToolsMenu updates correctly.
    try {
      pluginManager.deactivate('plugin-events').catch((e) => console.warn(e));
    } catch (e) {
      console.warn('[PluginEvents] failed to deactivate plugin', e);
    }
  }

  close() {
    bus.emit(BoardEvents.OVERLAY_OFFSET_CHANGED, { offset: 0 });
    super.close();
  }

  async refresh() {
    this.loading = true;
    const [events, categories] = await Promise.all([
      dataService.getEvents(),
      dataService.getEventCategories(),
    ]);
    this.events = events || [];
    this.categories = categories || [];
    this.loading = false;
    this._renderSvg();
    this.requestUpdate();
  }

  // ---------------------------------------------------------------------------
  // CRUD helpers
  // ---------------------------------------------------------------------------

  _startEdit(ev) {
    this._editId = ev.id;
    this._editDate = ev.date;
    this._editEndDate = ev.end_date || '';
    this._editTitle = ev.title;
    this._editPlanId = ev.plan_id;
    this._editCategory = ev.category || '';
  }

  _cancelEdit() {
    this._editId = null;
    this._editDate = '';
    this._editEndDate = '';
    this._editTitle = '';
    this._editPlanId = '';
    this._editCategory = '';
  }

  async _saveEdit() {
    if (!this._editDate || !this._editTitle || !this._editPlanId) return;
    this._saving = true;
    const payload = {
      date: this._editDate,
      title: this._editTitle,
      plan_id: this._editPlanId,
      category: this._editCategory,
      end_date: this._editEndDate ?? '',
    };
    const updated = await dataService.updateEvent(this._editId, payload);
    if (updated) {
      await this.refresh();
      bus.emit(PlanEventEvents.CHANGED);
      this._cancelEdit();
    }
    this._saving = false;
  }

  async _deleteEvent(eventId) {
    await dataService.deleteEvent(eventId);
    await this.refresh();
    bus.emit(PlanEventEvents.CHANGED);
  }

  async _addEvent(planId) {
    const date = this._newDates[planId] || '';
    const endDate = this._newEndDates[planId] || '';
    const title = this._newTitles[planId] || '';
    const category = this._newCategories[planId] ?? this.categories[0]?.name ?? '';
    if (!date || !title) return;
    this._saving = true;
    const payload = { date, title, plan_id: planId, category };
    if (endDate) payload.end_date = endDate;
    const created = await dataService.createEvent(payload);
    if (created) {
      this._newDates = { ...this._newDates, [planId]: '' };
      this._newEndDates = { ...this._newEndDates, [planId]: '' };
      this._newTitles = { ...this._newTitles, [planId]: '' };
      this._newCategories = { ...this._newCategories, [planId]: '' };
      this._addOpenPlanIds = { ...this._addOpenPlanIds, [planId]: false };
      await this.refresh();
      bus.emit(PlanEventEvents.CHANGED);
    }
    this._saving = false;
  }

  // ---------------------------------------------------------------------------
  // Category CRUD helpers
  // ---------------------------------------------------------------------------

  _startCatEdit(cat) {
    this._editCatId = cat.id;
    this._editCatName = cat.name;
  }

  _cancelCatEdit() {
    this._editCatId = null;
    this._editCatName = '';
  }

  async _saveCatEdit() {
    if (!this._editCatName.trim()) return;
    this._catSaving = true;
    const updated = await dataService.updateEventCategory(this._editCatId, { name: this._editCatName.trim() });
    if (updated) {
      await this.refresh();
      this._cancelCatEdit();
    }
    this._catSaving = false;
  }

  async _toggleSpecial(cat) {
    await dataService.updateEventCategory(cat.id, { is_special: !cat.is_special });
    await this.refresh();
  }

  async _addCategory() {
    if (!this._newCatName.trim()) return;
    this._catSaving = true;
    const created = await dataService.createEventCategory({ name: this._newCatName.trim() });
    if (created) {
      this._newCatName = '';
      await this.refresh();
    }
    this._catSaving = false;
  }

  async _deleteCategory(categoryId) {
    await dataService.deleteEventCategory(categoryId);
    await this.refresh();
  }

  _toggleCategoryVisibility(catName) {
    const hidden = { ...this._hiddenCategories };
    if (hidden[catName]) {
      delete hidden[catName];
    } else {
      hidden[catName] = true;
    }
    this._hiddenCategories = hidden;
    this._renderSvg();
  }

  // ---------------------------------------------------------------------------
  // Toolbar render
  // ---------------------------------------------------------------------------

  _renderCategoriesSection() {
    return html`
      <div class="plan-section">
        <div class="section-header">Event Categories</div>
          ${this.categories.map(cat => {
          if (this._editCatId === cat.id) {
            return html`
              <div class="edit-row">
                <input
                  type="text"
                  .value=${this._editCatName}
                  @input=${(e) => (this._editCatName = e.target.value)}
                />
                <div class="edit-actions">
                  <button class="btn cancel" @click=${this._cancelCatEdit}>Cancel</button>
                  <button class="btn save" ?disabled=${this._catSaving} @click=${this._saveCatEdit}>Save</button>
                </div>
              </div>
            `;
          }
          const visible = !this._hiddenCategories[cat.name];
          return html`
            <div class="cat-row">
              <button
                class="star-btn ${cat.is_special ? 'active' : ''}"
                title="${cat.is_special ? 'Special (black border) — click to unset' : 'Set as special (renders with black border)'}"
                @click=${() => this._toggleSpecial(cat)}
              >★</button>
              <span
                class="cat-name ${visible ? 'visible' : ''}"
                @click=${() => this._toggleCategoryVisibility(cat.name)}
                title="${visible ? 'Hide' : 'Show'} ${cat.name} events"
              >${cat.name}</span>
              <button class="icon-btn" title="Edit" @click=${() => this._startCatEdit(cat)}>✎</button>
              <button class="icon-btn delete" title="Delete" @click=${() => this._deleteCategory(cat.id)}>✕</button>
            </div>
          `;
        })}
        <div class="add-row" style="margin-top:6px">
          <input
            type="text"
            placeholder="New category…"
            .value=${this._newCatName}
            @input=${(e) => (this._newCatName = e.target.value)}
            @keydown=${(e) => e.key === 'Enter' && this._addCategory()}
            style="flex:1"
          />
          <button
            class="add-btn"
            ?disabled=${this._catSaving || !this._newCatName.trim()}
            @click=${this._addCategory}
          >Add</button>
        </div>
      </div>
    `;
  }

  

  _renderEventRow(ev) {
    if (this._editId === ev.id) {
      const plans = state.projects || [];
      return html`
        <div class="edit-row">
          <input
            type="date"
            .value=${this._editDate}
            @input=${(e) => (this._editDate = e.target.value)}
          />
          <input
            type="date"
            .value=${this._editEndDate}
            @input=${(e) => (this._editEndDate = e.target.value)}
          />
          <input
            type="text"
            .value=${this._editTitle}
            @input=${(e) => (this._editTitle = e.target.value)}
          />
          <select @change=${(e) => (this._editPlanId = e.target.value)}>
            ${plans.map(
              (p) =>
                html`<option value=${p.id} ?selected=${p.id === this._editPlanId}
                  >${p.name}</option
                >`
            )}
          </select>
          <select @change=${(e) => (this._editCategory = e.target.value)}>
            <option value="" ?selected=${this._editCategory === ''}>(none)</option>
            ${this.categories.map(
              (cat) => html`<option value=${cat.name} ?selected=${cat.name === this._editCategory}>${cat.name}</option>`
            )}
          </select>
          <div class="edit-actions">
            <button class="btn cancel" @click=${this._cancelEdit}>Cancel</button>
            <button class="btn save" ?disabled=${this._saving} @click=${this._saveEdit}>
              Save
            </button>
          </div>
        </div>
      `;
    }
    return html`
      <div class="event-row">
        <span class="event-date">${ev.date}${ev.end_date ? ` → ${ev.end_date}` : ''}</span>
        <span class="event-title" title=${ev.title}>${ev.title}</span>
        <button class="icon-btn" title="Edit" @click=${() => this._startEdit(ev)}>✎</button>
        <button
          class="icon-btn delete"
          title="Delete"
          @click=${() => this._deleteEvent(ev.id)}
        >✕</button>
      </div>
    `;
  }

  _renderPlanSection(plan) {
    const planEvents = this.events
      .filter((ev) => ev.plan_id === plan.id && !this._hiddenCategories[ev.category])
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first
    const newDate = this._newDates[plan.id] || '';
    const newTitle = this._newTitles[plan.id] || '';
    const newCategory = this._newCategories[plan.id] ?? this.categories[0]?.name ?? '';
    const addOpen = !!this._addOpenPlanIds[plan.id];
    return html`
      <div class="plan-section">
        <div class="plan-header">
          <span class="plan-color-dot" style="background:${plan.color}"></span>
          <span class="plan-name">${plan.name}</span>
          <button
            class="add-toggle-btn"
            title="Add event"
            @click=${() => {
              this._addOpenPlanIds = { ...this._addOpenPlanIds, [plan.id]: !addOpen };
            }}
          >+</button>
          <span class="event-count-badge">${planEvents.length}</span>
        </div>

        <div class="events-list">
          ${planEvents.length === 0
            ? html`<div class="empty-msg">No events</div>`
            : planEvents.map((ev) => this._renderEventRow(ev))}
        </div>

        ${addOpen ? html`
          <div class="add-row">
            <input
              type="date"
              .value=${newDate}
              @input=${(e) => {
                this._newDates = { ...this._newDates, [plan.id]: e.target.value };
              }}
              title="Event start date"
            />
            <input
              type="date"
              .value=${this._newEndDates[plan.id] || ''}
              @input=${(e) => {
                this._newEndDates = { ...this._newEndDates, [plan.id]: e.target.value };
              }}
              title="Event end date (optional)"
            />
            <input
              type="text"
              placeholder="Title…"
              .value=${newTitle}
              @input=${(e) => {
                this._newTitles = { ...this._newTitles, [plan.id]: e.target.value };
              }}
              @keydown=${(e) => e.key === 'Enter' && this._addEvent(plan.id)}
              title="Event title"
            />
            <select
              @change=${(e) => {
                this._newCategories = { ...this._newCategories, [plan.id]: e.target.value };
              }}
            >
              <option value="" ?selected=${this._newCategories[plan.id] === ''}>(none)</option>
              ${this.categories.map(
                  (cat) => html`<option value=${cat.name} ?selected=${cat.name === newCategory}>${cat.name}</option>`
              )}
            </select>
            <button
              class="add-btn"
              ?disabled=${this._saving || !newDate || !newTitle}
              @click=${() => this._addEvent(plan.id)}
            >
              Add
            </button>
          </div>` : ''}
      </div>
    `;
  }

  render() {
    const selectedPlans = (state.projects || []).filter((p) => p.selected);
    return html`
      <div class="floating-toolbar">
        <button class="close-btn" @click=${this._handleClose} title="Close">✕</button>
        <div class="toolbar-title">Plan Events</div>
        <div class="floating-content">
          ${this.loading ? html`<div class="loading-msg">Loading…</div>` : ''}
          ${this._renderCategoriesSection()}
          ${selectedPlans.length === 0
            ? html`<div class="no-plans-msg">No plans selected.</div>`
            : selectedPlans.map((plan) => this._renderPlanSection(plan))}
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // SVG overlay
  // ---------------------------------------------------------------------------

  _renderSvg() {
    if (!this.visible || !this._svgEl) return;

    if (!this._svgEl.isConnected) {
      this._attachOverlay();
      if (!this._svgEl?.isConnected) return;
    }

    this._svgEl.innerHTML = '';

    if (!this.events.length) {
      bus.emit(BoardEvents.OVERLAY_OFFSET_CHANGED, { offset: 0 });
      return;
    }

    const board = findInBoard('feature-board');
    const brClient = board.getBoundingClientRect();
    const boardRect = {
      left: brClient.left,
      top: brClient.top,
      width: brClient.width,
      height: brClient.height,
    };
    const monthWidth = TIMELINE_CONFIG.monthWidth;
    const months = getTimelineMonths();

    if (!months?.length) {
      bus.emit(BoardEvents.OVERLAY_OFFSET_CHANGED, { offset: 0 });
      return;
    }

    this._svgEl.setAttribute('width', boardRect.width);
    this._svgEl.setAttribute('height', boardRect.height);
    this._svgEl.setAttribute('viewBox', `0 0 ${boardRect.width} ${boardRect.height}`);
    this._svgEl.style.width = `${boardRect.width}px`;
    this._svgEl.style.height = `${boardRect.height}px`;

    const selectedProjects = (state.projects || []).filter((p) => p.selected).map((p) => p.id);
    if (!selectedProjects.length) {
      bus.emit(BoardEvents.OVERLAY_OFFSET_CHANGED, { offset: 0 });
      return;
    }

    const filteredEvents = this.events.filter(
      (ev) => selectedProjects.includes(ev.plan_id) && !this._hiddenCategories[ev.category]
    );

    const positioned = filteredEvents
      .map((ev) => {
        const startX = this._calcX(new Date(ev.date), months, monthWidth);
        if (startX === null) return null;
        let endX = startX;
        if (ev.end_date) {
          const endCalc = this._calcX(new Date(ev.end_date), months, monthWidth);
          if (endCalc !== null) {
            endX = Math.max(startX, endCalc);
          } else {
            // If end date falls beyond visible months, extend to board edge
            const endDateObj = new Date(ev.end_date);
            const lastMonth = months[months.length - 1];
            const lastMonthEnd = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0);
            if (endDateObj > lastMonthEnd) endX = boardRect.width;
          }
        }
        return { ev, xStart: startX, xEnd: endX };
      })
      .filter(Boolean);

    positioned.sort((a, b) => a.xStart - b.xStart);

    // Detect whether the markers overlay is active so event tags can be
    // shifted down by one row to avoid overlap with the markers row.
    const markersActive = pluginManager.get('plugin-markers')?.active ?? false;

    // Track clusters to stack tags that land on the same X position
    const xStack = [];

    positioned.forEach(({ ev, xStart, xEnd }) => {
      const x = xStart;
      let cluster = xStack.find((c) => Math.abs(c.maxX - x) < TAG_CLUSTER_THRESHOLD);
      if (!cluster) {
        cluster = { maxX: x, rows: 0 };
        xStack.push(cluster);
      }
      cluster.maxX = Math.max(cluster.maxX, x);
      const row = cluster.rows;
      cluster.rows++;

      this._createEventTag(xStart, xEnd, ev, boardRect.height, boardCoords.scrollY, row, markersActive);
    });

    // Broadcast the clearance FeatureBoard needs so its first card row does not
    // overlap with event tags. Formula: 5px top gap + N rows × (18px tag + 3px gap) + 4px margin.
    const maxEventRows = xStack.reduce((max, c) => Math.max(max, c.rows), 0);
    bus.emit(BoardEvents.OVERLAY_OFFSET_CHANGED, {
      offset: maxEventRows === 0 ? 0 : 6 + maxEventRows * 21,
    });
  }

  /**
   * Convert a date to board-space X. Returns null for out-of-range dates.
   * @param {Date} date
   * @param {Date[]} months
   * @param {number} monthWidth
   * @returns {number|null}
   */
  _calcX(date, months, monthWidth) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const monthIndex = months.findIndex(
      (m) => m.getFullYear() === year && m.getMonth() === month
    );
    if (monthIndex === -1) return null;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dayRatio = (date.getDate() - 1) / daysInMonth;
    return (monthIndex + dayRatio) * monthWidth;
  }

  /**
   * Draw a single event: vertical dashed line + tag anchored to top of board.
   * Tag colour matches the plan colour.
   *
  * @param {number} xStart         Board-space start X coordinate
  * @param {number} xEnd           Board-space end X coordinate (same as xStart for single-day)
  * @param {{id:string,date:string,title:string,plan_id:string}} ev
   * @param {number} boardHeight
   * @param {number} scrollY        Current vertical scroll of the board
   * @param {number} row            Stack row (0 = nearest top, 1 = one below, …)
   * @param {boolean} markersActive Whether the markers overlay is also visible
   */
  _createEventTag(xStart, xEnd, ev, boardHeight, scrollY, row, markersActive) {
    const plan = (state.projects || []).find((p) => p.id === ev.plan_id);
    const color = plan?.color || '#1565c0';

    const tagPadding = 6;
    const label = ev.title.length > 16 ? ev.title.slice(0, 14) + '…' : ev.title;
    const labelWidth = label.length * 5.5;
    const tagWidth = labelWidth + tagPadding * 2;

    // Tags sit at the top of the board, scrollY-adjusted like markers.
    // When markers are also active, shift events down by one tag height + gap
    // so they occupy the row immediately below the markers row.
    const markerOffset = markersActive ? TAG_HEIGHT + 4 : 0;
    const tagY = (scrollY ?? 0) + 5 + markerOffset + row * (TAG_HEIGHT + 3);

    // If this event spans a range (xEnd > xStart), draw a translucent band
    if (xEnd && xEnd > xStart + 1) {
      const band = document.createElementNS(SVG_NS, 'rect');
      band.setAttribute('x', xStart);
      band.setAttribute('y', 0);
      band.setAttribute('width', Math.max(1, xEnd - xStart));
      band.setAttribute('height', boardHeight);
      band.setAttribute('fill', color);
      band.setAttribute('opacity', '0.12');
      band.style.pointerEvents = 'none';
      this._svgEl.appendChild(band);

      // also draw a subtle start-line for visual anchor
      const startLine = document.createElementNS(SVG_NS, 'line');
      startLine.setAttribute('x1', xStart);
      startLine.setAttribute('y1', 0);
      startLine.setAttribute('x2', xStart);
      startLine.setAttribute('y2', boardHeight);
      startLine.setAttribute('stroke', color);
      startLine.setAttribute('opacity', '0.45');
      startLine.setAttribute('stroke-width', '1');
      startLine.setAttribute('stroke-dasharray', '3,5');
      startLine.style.pointerEvents = 'none';
      this._svgEl.appendChild(startLine);
    } else {
      // Vertical dashed line spanning the full board height for single-day events
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', xStart);
      line.setAttribute('y1', 0);
      line.setAttribute('x2', xStart);
      line.setAttribute('y2', boardHeight);
      line.setAttribute('stroke', color);
      line.setAttribute('opacity', '0.4');
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-dasharray', '3,5');
      line.style.pointerEvents = 'none';
      this._svgEl.appendChild(line);
    }

    // Tag group
    const tagGroup = document.createElementNS(SVG_NS, 'g');
    tagGroup.setAttribute('class', 'event-tag');
    tagGroup.style.cursor = 'default';
    tagGroup.style.pointerEvents = 'auto';

    const tagBg = document.createElementNS(SVG_NS, 'rect');
    tagBg.setAttribute('x', xStart - tagWidth / 2);
    tagBg.setAttribute('y', tagY);
    tagBg.setAttribute('width', tagWidth);
    tagBg.setAttribute('height', TAG_HEIGHT);
    tagBg.setAttribute('fill', color);
    tagBg.setAttribute('rx', '3');
    tagBg.setAttribute('opacity', '0.85');
    const specialCat = this.categories.find(c => c.is_special);
    if (specialCat && ev.category === specialCat.name) {
      tagBg.setAttribute('stroke', 'black');
      tagBg.setAttribute('stroke-width', '1');
    }
    tagGroup.appendChild(tagBg);

    const tagText = document.createElementNS(SVG_NS, 'text');
    tagText.setAttribute('x', xStart);
    tagText.setAttribute('y', tagY + 13);
    tagText.setAttribute('fill', 'white');
    tagText.setAttribute('font-size', '10');
    tagText.setAttribute('font-weight', '600');
    tagText.setAttribute('text-anchor', 'middle');
    tagText.textContent = label;
    tagGroup.appendChild(tagText);

    // Tooltip on hover
    const titleEl = document.createElementNS(SVG_NS, 'title');
    const tooltipParts = [
      ev.title,
      plan ? `Plan: ${plan.name}` : '',
      ev.end_date ? `Date: ${ev.date} → ${ev.end_date}` : `Date: ${ev.date}`,
    ].filter(Boolean);
    titleEl.textContent = tooltipParts.join('\n');
    tagGroup.appendChild(titleEl);

    this._svgEl.appendChild(tagGroup);
  }
}

customElements.define('plugin-events', PluginEventsComponent);
export default PluginEventsComponent;
