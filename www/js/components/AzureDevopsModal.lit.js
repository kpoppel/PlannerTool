import { LitElement, html, css } from '../vendor/lit.js';
import './Modal.lit.js';
import { groupService } from '../services/GroupService.js';

export class AzureDevopsModal extends LitElement {
  static properties = {
    overrides: { type: Object },
    state: { type: Object },
    /** Array<{ type:'create'|'update'|'delete', group?, groupId?, groupName?, fields? }> */
    pendingGroupChanges: { type: Array },
  };

  constructor() {
    super();
    this.overrides = {};
    this.state = null;
    this.pendingGroupChanges = [];
    this._selected = new Set();
  }

  firstUpdated() {
    // Feature overrides: unchecked by default — user explicitly picks what to persist.
    // Group structural ops: pre-selected since they are always intentional.
    (this.pendingGroupChanges || []).forEach((_, i) => this._selected.add(`grp_${i}`));
    // open the inner modal once rendered
    const inner =
      this.renderRoot ?
        this.renderRoot.querySelector('modal-lit')
      : this.querySelector('modal-lit');
    if (inner) inner.open = true;
  }

  _formatRange(from, to) {
    // undefined → field not overridden, just show the original value
    if (to === undefined) return from || '—';
    const f = from || null;
    const t = to || null; // normalise empty string to null
    if (f === null && t === null) return '—';
    if (t === null) return html`${f || '—'} \u2192 <em style="color:#c0392b">(cleared)</em>`;
    if (f === t) return f;
    return `${f || '—'} \u2192 ${t}`;
  }

  _toggleAll(allKeys) {
    const anyUnchecked = allKeys.some((k) => !this._selected.has(k));
    if (anyUnchecked) allKeys.forEach((k) => this._selected.add(k));
    else allKeys.forEach((k) => this._selected.delete(k));
    this.requestUpdate();
  }

  _onCheckboxChange(e) {
    const id = e.target.dataset.id;
    if (e.target.checked) this._selected.add(id);
    else this._selected.delete(id);
    this.requestUpdate();
  }

  _onSave() {
    // Feature overrides: keys are plain feature IDs (group op keys are prefixed 'grp_')
    const selected = Array.from(this._selected)
      .filter((k) => !k.startsWith('grp_'))
      .map((id) => {
        const ov = this.overrides[id] || {};
        const out = { id };
        if ('start' in ov) out.start = ov.start;
        if ('end' in ov) out.end = ov.end;
        if (ov.capacity) out.capacity = ov.capacity;
        if (ov.state) out.state = ov.state;
        if ('iterationPath' in ov) out.iterationPath = ov.iterationPath;
        if ('groupId' in ov) out.groupId = ov.groupId;
        return out;
      });
    const selectedGroupChanges = (this.pendingGroupChanges || []).filter(
      (_, i) => this._selected.has(`grp_${i}`)
    );
    this.dispatchEvent(
      new CustomEvent('azure-save', {
        detail: { features: selected, groupChanges: selectedGroupChanges },
        bubbles: true,
        composed: true,
      })
    );
    this.remove();
  }

  _onCancel() {
    this.remove();
  }

  /**
   * Build per-row change metadata and render the table.
   * Columns with no changes across all rows are hidden entirely.
   * Cells that did not change within a row are dimmed.
   */
  _renderTable(entries, groupOps) {
    const normDate = (v) => v || null;

    // Resolve a groupId to a display name using the GroupService cache.
    const groupName = (id) =>
      id ? (groupService.getGroupById(String(id))?.name ?? String(id)) : '—';

    // Build row data with per-cell change flags
    const rows = entries.map(([id, ov]) => {
      const base =
        this.state && this.state.baselineFeatures ?
          this.state.baselineFeatures.find((f) => f.id === id) || {}
        : {};
      const origStart = base.start || '';
      const origEnd = base.end || '';
      const origCapacity = base.capacity || [];
      const origState = base.state || '';
      const origIterationPath = base.iterationPath || '';
      const origGroupId = base.groupId ?? null;

      const startChanged = 'start' in ov && normDate(ov.start) !== normDate(origStart);
      const endChanged = 'end' in ov && normDate(ov.end) !== normDate(origEnd);
      const capacityChanged =
        ov.capacity && JSON.stringify(ov.capacity) !== JSON.stringify(origCapacity);
      const stateChanged = ov.state && ov.state !== origState;
      const iterationChanged =
        'iterationPath' in ov && (ov.iterationPath || null) !== (origIterationPath || null);
      const groupIdChanged =
        'groupId' in ov && (ov.groupId ?? null) !== origGroupId;

      // Format capacity diff
      let capacityContent = '';
      if (capacityChanged) {
        const teams = this.state?.teams || [];
        const origMap = new Map(origCapacity.map((c) => [c.team, c.capacity]));
        const newMap = new Map(ov.capacity.map((c) => [c.team, c.capacity]));
        const allTeams = new Set([...origMap.keys(), ...newMap.keys()]);
        const changes = [];
        for (const teamId of allTeams) {
          const origVal = origMap.get(teamId);
          const newVal = newMap.get(teamId);
          if (origVal === newVal) continue;
          const name = teams.find((t) => t.id === teamId)?.name || teamId;
          if (origVal === undefined)
            changes.push(html`<div><strong>${name}:</strong> +${newVal}%</div>`);
          else if (newVal === undefined)
            changes.push(html`<div><strong>${name}:</strong> ${origVal}% → removed</div>`);
          else
            changes.push(html`<div><strong>${name}:</strong> ${origVal}% → ${newVal}%</div>`);
        }
        capacityContent = html`${changes}`;
      }

      return {
        id, ov,
        origStart, origEnd, origState, origIterationPath, origGroupId,
        startChanged, endChanged, capacityChanged, stateChanged, iterationChanged, groupIdChanged,
        capacityContent,
      };
    });

    // Only show columns that have at least one changed cell across all rows
    const showStart     = rows.some((r) => r.startChanged);
    const showEnd       = rows.some((r) => r.endChanged);
    const showCapacity  = rows.some((r) => r.capacityChanged);
    const showState     = rows.some((r) => r.stateChanged);
    const showIteration = rows.some((r) => r.iterationChanged);
    const showGroup     = rows.some((r) => r.groupIdChanged) || (groupOps && groupOps.length > 0);

    // Number of detail columns after "Title" — used for colspan on group op rows.
    const detailCols = [showStart, showEnd, showCapacity, showState, showIteration, showGroup]
      .filter(Boolean).length;

    // Helper: render a table cell styled by whether its value changed
    const td = (changed, content) =>
      html`<td class=${changed ? 'changed' : 'unchanged'}>${content}</td>`;

    return html`
      <table class="scenario-annotate-table">
        <thead>
          <tr>
            <th style="width:64px">Select</th>
            <th>Title</th>
            ${showStart     ? html`<th>Start</th>`     : ''}
            ${showEnd       ? html`<th>End</th>`       : ''}
            ${showCapacity  ? html`<th>Capacity</th>`  : ''}
            ${showState     ? html`<th>State</th>`     : ''}
            ${showIteration ? html`<th>Iteration</th>` : ''}
            ${showGroup     ? html`<th>Group</th>`     : ''}
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => html`
            <tr>
              <td>
                <input
                  type="checkbox"
                  .checked=${this._selected.has(r.id)}
                  data-id=${r.id}
                  @change=${this._onCheckboxChange}
                />
              </td>
              <td>${this.state ? this.state.getFeatureTitleById(r.id) : r.id}</td>
              ${showStart ? td(r.startChanged,
                  this._formatRange(r.origStart, r.ov.start)) : ''}
              ${showEnd ? td(r.endChanged,
                  this._formatRange(r.origEnd, r.ov.end)) : ''}
              ${showCapacity ? td(r.capacityChanged,
                  r.capacityChanged ?
                    html`<span style="font-size:0.9em;line-height:1.4;">${r.capacityContent}</span>`
                  : html`<span style="font-size:0.9em;">—</span>`) : ''}
              ${showState ? td(r.stateChanged,
                  r.stateChanged ?
                    html`<span style="font-size:0.9em;">${r.origState || '—'} → <strong>${r.ov.state}</strong></span>`
                  : html`<span style="font-size:0.9em;">${r.origState || '—'}</span>`) : ''}
              ${showIteration ? td(r.iterationChanged,
                  r.iterationChanged ?
                    html`<span style="font-size:0.9em;">
                      ${r.origIterationPath || '—'} →
                      <strong>${r.ov.iterationPath || html`<em style="color:#c0392b">(cleared)</em>`}</strong>
                    </span>`
                  : html`<span style="font-size:0.9em;">${r.origIterationPath || '—'}</span>`) : ''}
              ${showGroup ? td(r.groupIdChanged,
                  r.groupIdChanged ?
                    html`<span style="font-size:0.9em;">${groupName(r.origGroupId)} → <strong>${groupName(r.ov.groupId)}</strong></span>`
                  : html`<span style="font-size:0.9em;">${groupName(r.origGroupId)}</span>`) : ''}
            </tr>
          `)}
          ${(groupOps || []).map((op, i) => {
            const key = `grp_${i}`;
            const planId = op.group?.plan_id || op.planId;
            const planName = planId
              ? (this.state?.projects?.find((p) => String(p.id) === String(planId))?.name ?? planId)
              : '';
            const grpName = op.group?.name ?? op.groupName ?? op.groupId ?? '?';
            const itemLabel = planName ? `Group '${grpName}' in ${planName}` : `Group '${grpName}'`;
            const actionLabel =
              op.type === 'create' ? html`<span style="color:#0a7c42;font-weight:600;">created</span>` :
              op.type === 'delete' ? html`<span style="color:#c0392b;font-weight:600;">deleted</span>` :
              html`renamed to '<strong>${op.fields?.name ?? '?'}</strong>'`;

            return html`
              <tr>
                <td>
                  <input
                    type="checkbox"
                    .checked=${this._selected.has(key)}
                    data-id=${key}
                    @change=${this._onCheckboxChange}
                  />
                </td>
                <td>${itemLabel}</td>
                ${showStart ? td(false, html`<span style="color:#999">—</span>`) : ''}
                ${showEnd ? td(false, html`<span style="color:#999">—</span>`) : ''}
                ${showCapacity ? td(false, html`<span style="color:#999">—</span>`) : ''}
                ${showState ? td(false, html`<span style="color:#999">—</span>`) : ''}
                ${showIteration ? td(false, html`<span style="color:#999">—</span>`) : ''}
                ${showGroup ? td(true, actionLabel) : ''}
              </tr>`;
          })}
        </tbody>
      </table>`;
  }

  render() {
    const allEntries = Object.entries(this.overrides || {});
    const groupOps = this.pendingGroupChanges || [];

    // Filter to only show features with actual changes (include state)
    const entries = allEntries.filter(([id, ov]) => {
      const baseFeature =
        this.state && this.state.baselineFeatures ?
          this.state.baselineFeatures.find((f) => f.id === id) || {}
        : {};
      const origStart = baseFeature.start || '';
      const origEnd = baseFeature.end || '';
      const origCapacity = baseFeature.capacity || [];
      const origState = baseFeature.state || '';

      const origIterationPath = baseFeature.iterationPath || '';

      // Guard: override entries from test fixtures or legacy data may not be
      // plain objects — bail out early to avoid TypeError from 'in' operator.
      if (!ov || typeof ov !== 'object') return false;

      // Normalise null/undefined/empty as "no value" when comparing dates.
      // This ensures cleared dates (null) are detected as a change from a
      // previously set date, and avoids false positives when both sides have
      // no date.
      const normDate = (v) => v || null;
      const hasStartChange = 'start' in ov && normDate(ov.start) !== normDate(origStart);
      const hasEndChange = 'end' in ov && normDate(ov.end) !== normDate(origEnd);
      const hasCapacityChange =
        ov.capacity && JSON.stringify(ov.capacity) !== JSON.stringify(origCapacity);
      const hasStateChange = ov.state && ov.state !== origState;
      const hasIterationChange =
        'iterationPath' in ov && (ov.iterationPath || null) !== (origIterationPath || null);
      const hasGroupChange =
        'groupId' in ov && (ov.groupId ?? null) !== (baseFeature.groupId ?? null);

      return hasStartChange || hasEndChange || hasCapacityChange || hasStateChange || hasIterationChange || hasGroupChange;
    });

    const hasAny = entries.length > 0 || groupOps.length > 0;
    // All selectable keys: feature IDs + group op keys (grp_0, grp_1, ...)
    const allKeys = [
      ...entries.map(([id]) => id),
      ...groupOps.map((_, i) => `grp_${i}`),
    ];

    return html`
      <modal-lit wide>
        <div slot="header"><h3>Save changes</h3></div>
        <div>
          <style>
            p {
              margin: 0 0 16px 0;
              color: #333;
              font-size: 14px;
            }
            .scenario-annotate-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 13px;
              background: #fff;
            }
            .scenario-annotate-table thead {
              background: #f5f5f5;
              position: sticky;
              top: 0;
            }
            .scenario-annotate-table th {
              padding: 10px 12px;
              text-align: left;
              font-weight: 600;
              color: #333;
              border: 1px solid #ddd;
              border-bottom: 2px solid #bbb;
            }
            .scenario-annotate-table td {
              padding: 10px 12px;
              border: 1px solid #ddd;
              vertical-align: top;
              color: #333;
            }
            /* Unchanged cells are visually de-emphasised */
            .scenario-annotate-table td.unchanged {
              color: #bbb;
              font-style: italic;
            }
            /* Changed cells get a subtle left accent so they stand out */
            .scenario-annotate-table td.changed {
              background: #fffbe6;
              border-left: 3px solid #e6a817;
            }
            .scenario-annotate-table tbody tr {
              background: #fff;
            }
            .scenario-annotate-table tbody tr:nth-child(even) {
              background: #fafafa;
            }
            .scenario-annotate-table tbody tr:hover {
              background: #f0f7ff;
            }
            .scenario-annotate-table input[type='checkbox'] {
              cursor: pointer;
              width: 16px;
              height: 16px;
            }
            .scenario-annotate-table td:first-child {
              text-align: center;
            }
            .scenario-annotate-table strong {
              color: #000;
              font-weight: 600;
            }
            .btn {
              padding: 6px 12px;
              background: #e9e9e9;
              border: 1px solid rgba(0, 0, 0, 0.06);
              border-radius: 6px;
              cursor: pointer;
              color: #333;
              font-size: 13px;
            }
            .btn:hover {
              background: #e0e0e0;
            }
          </style>
          ${!hasAny ?
            html`<p style="color:#888;">No changes to save.</p>`
          : html`
              <p>Select which changes to persist:</p>
              <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
                <button type="button" @click=${() => this._toggleAll(allKeys)} class="btn">
                  Toggle All/None
                </button>
              </div>
              <div style="max-height:60vh;overflow-y:auto;padding-right:8px;">
                ${this._renderTable(entries, groupOps)}
              </div>
            `}
        </div>
        <div slot="footer" class="modal-footer">
          <button class="btn" @click=${this._onCancel}>Cancel</button>
          ${hasAny ?
            html`<button class="btn primary" @click=${this._onSave}>
              Save
            </button>`
          : ''}
        </div>
      </modal-lit>
    `;
  }
}

customElements.define('azure-devops-modal', AzureDevopsModal);
