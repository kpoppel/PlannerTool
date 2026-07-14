/**
 * EventsPanel - Inline panel for managing plan events (CRUD).
 * Rendered inside PlanMenu for a specific plan.
 */
import { LitElement, html, css } from '../vendor/lit.js';
import { applicationApi as state } from '../application/plannerApplication.js';
import { bus } from '../core/EventBus.js';
import { PlanEventEvents } from '../core/EventRegistry.js';

export class EventsPanel extends LitElement {
  static properties = {
    planId: { type: String },
    events: { type: Array },
    categories: { type: Array },
    loading: { type: Boolean },
    _editId: { type: String, state: true },
    _editDate: { type: String, state: true },
    _editEndDate: { type: String, state: true },
    _editTitle: { type: String, state: true },
    _editPlanId: { type: String, state: true },
    _editCategory: { type: String, state: true },
    _newDate: { type: String, state: true },
    _newEndDate: { type: String, state: true },
    _newTitle: { type: String, state: true },
    _newCategory: { type: String, state: true },
    _saving: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: block;
    }

    .panel {
      background: rgba(0, 0, 0, 0.18);
      border-radius: 6px;
      padding: 8px;
      margin-top: 4px;
    }

    .panel-title {
      font-size: 11px;
      font-weight: 700;
      color: #a0c4f8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    }

    .event-row {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .event-row:last-child {
      border-bottom: none;
    }

    .event-date {
      font-size: 10px;
      color: #aaa;
      min-width: 74px;
      flex: 0 0 74px;
    }

    .event-title {
      font-size: 12px;
      color: var(--color-sidebar-text, #e0e0e0);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .icon-btn {
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 2px 4px;
      color: #aaa;
      border-radius: 3px;
      font-size: 13px;
      line-height: 1;
      flex: 0 0 auto;
    }

    .icon-btn:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.12);
    }

    .icon-btn.delete:hover {
      color: #f87171;
    }

    .edit-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 6px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .edit-row input,
    .edit-row select {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      color: #e0e0e0;
      font-size: 12px;
      padding: 3px 6px;
      width: 100%;
      box-sizing: border-box;
    }

    .edit-row select option {
      background: #2a2a3a;
      color: #e0e0e0;
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

    .btn {
      background: #3a5aad;
      border: none;
      border-radius: 4px;
      color: #fff;
      cursor: pointer;
      font-size: 11px;
      padding: 3px 8px;
    }

    .btn:hover {
      background: #5481e6;
    }

    .btn.cancel {
      background: rgba(255, 255, 255, 0.1);
      color: #aaa;
    }

    .btn.cancel:hover {
      background: rgba(255, 255, 255, 0.18);
      color: #e0e0e0;
    }

    .add-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding-top: 6px;
    }

    .add-row input {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 4px;
      color: #e0e0e0;
      font-size: 12px;
      padding: 3px 6px;
      width: 100%;
      box-sizing: border-box;
    }

    .add-row input:focus {
      outline: none;
      border-color: #5481e6;
    }

    .add-row input::placeholder {
      color: #666;
    }

    .add-actions {
      display: flex;
      gap: 4px;
      justify-content: flex-end;
    }

    .empty-msg {
      font-size: 11px;
      color: #666;
      font-style: italic;
      padding: 2px 0 6px;
    }

    .loading-msg {
      font-size: 11px;
      color: #888;
      padding: 4px 0;
    }
  `;

  constructor() {
    super();
    this.planId = null;
    this.events = [];
    this.categories = [];
    this.loading = false;
    this._editId = null;
    this._editDate = '';
    this._editEndDate = '';
    this._editTitle = '';
    this._editPlanId = '';
    this._editCategory = '';
    this._newDate = '';
    this._newEndDate = '';
    this._newTitle = '';
    this._newCategory = '';
    this._saving = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
  }

  async _load() {
    this.loading = true;
    const [events, categories] = await Promise.all([
      state.events.getAll(this.planId),
      state.events.getCategories(),
    ]);
    this.events = events || [];
    this.categories = categories || [];
    this.loading = false;
  }

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
    const updated = await state.events.update(this._editId, payload);
    if (updated) {
      await this._load();
      bus.emit(PlanEventEvents.CHANGED);
      this._cancelEdit();
    }
    this._saving = false;
  }

  async _deleteEvent(eventId) {
    await state.events.delete(eventId);
    await this._load();
    bus.emit(PlanEventEvents.CHANGED);
  }

  async _addEvent() {
    if (!this._newDate || !this._newTitle) return;
    this._saving = true;
    const payload = {
      date: this._newDate,
      title: this._newTitle,
      plan_id: this.planId,
      category: this._newCategory ?? '',
    };
    if (this._newEndDate) payload.end_date = this._newEndDate;
    const created = await state.events.create(payload);
    if (created) {
      await this._load();
      bus.emit(PlanEventEvents.CHANGED);
      this._newDate = '';
      this._newEndDate = '';
      this._newTitle = '';
      this._newCategory = '';
    }
    this._saving = false;
  }

  _renderEventRow(ev) {
    if (this._editId === ev.id) {
      const plans = (state.projects || []);
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
            placeholder="Title"
            .value=${this._editTitle}
            @input=${(e) => (this._editTitle = e.target.value)}
          />
          <select
            .value=${this._editPlanId}
            @change=${(e) => (this._editPlanId = e.target.value)}
          >
            <option value="" ?selected=${this._editPlanId === ''}>(none)</option>
            ${plans.map(
              (p) => html`<option value=${p.id} ?selected=${p.id === this._editPlanId}>${p.name}</option>`
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
            <button class="btn" ?disabled=${this._saving} @click=${this._saveEdit}>Save</button>
          </div>
        </div>
      `;
    }
    return html`
      <div class="event-row">
        <span class="event-date">${ev.date}${ev.end_date ? ` → ${ev.end_date}` : ''}</span>
        <span class="event-title" title=${ev.title}>${ev.title}</span>
        <button class="icon-btn" title="Edit event" @click=${() => this._startEdit(ev)}>✎</button>
        <button class="icon-btn delete" title="Delete event" @click=${() => this._deleteEvent(ev.id)}>✕</button>
      </div>
    `;
  }

  render() {
    return html`
      <div class="panel">
        <div class="panel-title">Events</div>

        ${this.loading
          ? html`<div class="loading-msg">Loading…</div>`
          : this.events.length === 0
          ? html`<div class="empty-msg">No events for this plan.</div>`
          : html`${this.events.map((ev) => this._renderEventRow(ev))}`}

        <div class="add-row">
          <input
            type="date"
            .value=${this._newDate}
            @input=${(e) => (this._newDate = e.target.value)}
            title="Event date"
          />
          <input
            type="text"
            placeholder="New event title…"
            .value=${this._newTitle}
            @input=${(e) => (this._newTitle = e.target.value)}
            @keydown=${(e) => e.key === 'Enter' && this._addEvent()}
            title="Event title"
          />
          <select @change=${(e) => (this._newCategory = e.target.value)}>
            <option value="" ?selected=${this._newCategory === ''}>(none)</option>
            ${this.categories.map(
              (cat) => html`<option value=${cat.name} ?selected=${cat.name === this._newCategory}>${cat.name}</option>`
            )}
          </select>
          <div class="add-actions">
            <button class="btn" ?disabled=${this._saving || !this._newDate || !this._newTitle} @click=${this._addEvent}>
              Add event
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('events-panel', EventsPanel);
export default EventsPanel;
