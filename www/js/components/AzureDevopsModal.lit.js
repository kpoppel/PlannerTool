import { LitElement, html, css } from '../vendor/lit.js';
import './Modal.lit.js';

export class AzureDevopsModal extends LitElement {
  static properties = {
    overrides: { type: Object },
    state: { type: Object },
  };

  constructor() {
    super();
    this.overrides = {};
    this.state = null;
    this._selected = new Set();
  }

  firstUpdated() {
    // Start with no items selected by default for safety
    // User must explicitly check items they want to annotate
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

  _toggleAll() {
    const keys = Object.keys(this.overrides || {});
    const anyUnchecked = keys.some((k) => !this._selected.has(k));
    if (anyUnchecked) keys.forEach((k) => this._selected.add(k));
    else keys.forEach((k) => this._selected.delete(k));
    this.requestUpdate();
  }

  _onCheckboxChange(e) {
    const id = e.target.dataset.id;
    if (e.target.checked) this._selected.add(id);
    else this._selected.delete(id);
    this.requestUpdate();
  }

  _onSave() {
    const selected = Array.from(this._selected).map((id) => {
      const ov = this.overrides[id] || {};
      // Only include keys that exist in the override so the backend can
      // distinguish "explicit clear (null)" from "not provided (absent)".
      const out = { id };
      if ('start' in ov) out.start = ov.start;
      if ('end' in ov) out.end = ov.end;
      if (ov.capacity) out.capacity = ov.capacity;
      if (ov.state) out.state = ov.state;
      if ('iterationPath' in ov) out.iterationPath = ov.iterationPath;
      return out;
    });
    this.dispatchEvent(
      new CustomEvent('azure-save', {
        detail: selected,
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
  _renderTable(entries) {
    const normDate = (v) => v || null;

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

      const startChanged = 'start' in ov && normDate(ov.start) !== normDate(origStart);
      const endChanged = 'end' in ov && normDate(ov.end) !== normDate(origEnd);
      const capacityChanged =
        ov.capacity && JSON.stringify(ov.capacity) !== JSON.stringify(origCapacity);
      const stateChanged = ov.state && ov.state !== origState;
      const iterationChanged =
        'iterationPath' in ov && (ov.iterationPath || null) !== (origIterationPath || null);

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
        origStart, origEnd, origState, origIterationPath,
        startChanged, endChanged, capacityChanged, stateChanged, iterationChanged,
        capacityContent,
      };
    });

    // Only show columns that have at least one changed cell across all rows
    const showStart     = rows.some((r) => r.startChanged);
    const showEnd       = rows.some((r) => r.endChanged);
    const showCapacity  = rows.some((r) => r.capacityChanged);
    const showState     = rows.some((r) => r.stateChanged);
    const showIteration = rows.some((r) => r.iterationChanged);

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
            </tr>
          `)}
        </tbody>
      </table>`;
  }

  render() {
    const allEntries = Object.entries(this.overrides || {});

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

      return hasStartChange || hasEndChange || hasCapacityChange || hasStateChange || hasIterationChange;
    });

    return html`
      <modal-lit wide>
        <div slot="header"><h3>Save to Azure DevOps</h3></div>
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
          <p>Select which items to annotate back to Azure DevOps:</p>
          ${entries.length === 0 ?
            html`<p style="color:#888;">No changes to save.</p>`
          : html`
              <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
                <button type="button" @click=${this._toggleAll} class="btn">
                  Toggle All/None
                </button>
              </div>
              <div style="max-height:60vh;overflow-y:auto;padding-right:8px;">
                ${this._renderTable(entries)}
              </div>
            `}
        </div>
        <div slot="footer" class="modal-footer">
          <button class="btn" @click=${this._onCancel}>Cancel</button>
          ${entries.length > 0 ?
            html`<button class="btn primary" @click=${this._onSave}>
              Save to Azure DevOps
            </button>`
          : ''}
        </div>
      </modal-lit>
    `;
  }
}

customElements.define('azure-devops-modal', AzureDevopsModal);
