import { LitElement, html, css } from '../vendor/lit.js';
import './Modal.lit.js';
import { groupService } from '../services/GroupService.js';

/** Field names supported in feature-override rows, in display order. */
const FIELDS = ['start', 'end', 'capacity', 'state', 'iterationPath', 'tags'];

/** Maps a field name to the boolean changed-flag property on a computed row. */
const CHANGED_KEY = {
  start: 'startChanged',
  end: 'endChanged',
  capacity: 'capacityChanged',
  state: 'stateChanged',
  iterationPath: 'iterationChanged',
  tags: 'tagsChanged',
};

/** Human-readable column label for each field. */
const FIELD_LABEL = {
  start: 'Start',
  end: 'End',
  capacity: 'Capacity',
  state: 'State',
  iterationPath: 'Iteration',
  tags: 'Tags',
};

/**
 * A group op is "structural" when it creates, deletes, or renames a group.
 * Pure member-delta ops are handled as per-task rows instead.
 * @param {object} op
 */
const isStructuralOp = (op) =>
  op.type === 'create' || op.type === 'delete' ||
  (op.type === 'update' && op.fields && Object.keys(op.fields).length > 0);

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
    // All cells start deselected — the user selects what to persist via
    // cell clicks, column header clicks, or the Toggle All button.
    // Open the inner modal once rendered.
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

  _parseTags(value) {
    if (!value || typeof value !== 'string') return [];
    return value
      .split(';')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  _normaliseTags(value) {
    return this._parseTags(value).map((t) => t.toLowerCase());
  }

  _normalisedTagSet(value) {
    return new Set(this._normaliseTags(value));
  }

  _formatTags(value) {
    const tags = this._parseTags(value);
    return tags.length ? tags.join(', ') : '—';
  }

  _formatTagsRange(from, to) {
    if (to === undefined) return this._formatTags(from);

    const fromTags = this._parseTags(from);
    const toTags = this._parseTags(to);
    const fromSet = this._normalisedTagSet(from);
    const toSet = this._normalisedTagSet(to);

    const removed = fromTags.filter((tag) => !toSet.has(tag.toLowerCase()));
    const added = toTags.filter((tag) => !fromSet.has(tag.toLowerCase()));

    if (!removed.length && !added.length) return this._formatTags(to);

    const parts = [];
    if (removed.length) {
      parts.push(html`<span style="color:#c0392b;">− ${removed.join(', ')}</span>`);
    }
    if (added.length) {
      parts.push(html`<span style="color:#0a7c42;">+ ${added.join(', ')}</span>`);
    }
    return html`${parts.map((p, i) => html`${i > 0 ? html`<br/>` : ''}${p}`)}`;
  }

  _tagsChanged(from, to) {
    const fromSet = this._normalisedTagSet(from);
    const toSet = this._normalisedTagSet(to);
    if (fromSet.size !== toSet.size) return true;
    for (const tag of fromSet) {
      if (!toSet.has(tag)) return true;
    }
    return false;
  }

  _getFeatureRowKeys(r) {
    const keys = FIELDS
      .filter((f) => r[CHANGED_KEY[f]])
      .map((f) => `${r.id}:${f}`);
    if (r.groupDelta) keys.push(r.groupDelta.key);
    return keys;
  }

  _isAllSelected(keys) {
    return keys.length > 0 && keys.every((k) => this._selected.has(k));
  }

  _onRowToggle(keys) {
    if (!keys.length) return;
    const allOn = this._isAllSelected(keys);
    if (allOn) keys.forEach((k) => this._selected.delete(k));
    else keys.forEach((k) => this._selected.add(k));
    this.requestUpdate();
  }

  _toggleAll(enrichedRows, groupOps, orphanDeltaRows) {
    const allKeys = [
      // Feature field cells
      ...enrichedRows.flatMap((r) =>
        FIELDS.filter((f) => r[CHANGED_KEY[f]]).map((f) => `${r.id}:${f}`)
      ),
      // Inline group-change cells on feature rows
      ...enrichedRows.filter((r) => r.groupDelta).map((r) => r.groupDelta.key),
      // Structural op rows — use original groupOps index
      ...(groupOps || []).flatMap((op, i) => isStructuralOp(op) ? [`grp_${i}`] : []),
      // Orphan member-only rows (tasks with group change but no field changes)
      ...(orphanDeltaRows || []).map((d) => d.key),
    ];
    const anyUnselected = allKeys.some((k) => !this._selected.has(k));
    if (anyUnselected) allKeys.forEach((k) => this._selected.add(k));
    else allKeys.forEach((k) => this._selected.delete(k));
    this.requestUpdate();
  }

  /** Toggle a single feature cell between selected and deselected. */
  _onCellClick(featureId, field) {
    const key = `${featureId}:${field}`;
    if (this._selected.has(key)) this._selected.delete(key);
    else this._selected.add(key);
    this.requestUpdate();
  }

  _onColumnHeaderClick(field, enrichedRows, groupOps, orphanDeltaRows) {
    const featureKeys = enrichedRows
      .filter((r) => r[CHANGED_KEY[field]])
      .map((r) => `${r.id}:${field}`);
    // Group column covers inline group cells on feature rows, structural ops, and orphan rows.
    const grpKeys = field === 'groupId'
      ? [
          ...enrichedRows.filter((r) => r.groupDelta).map((r) => r.groupDelta.key),
          ...(groupOps || []).flatMap((op, i) => isStructuralOp(op) ? [`grp_${i}`] : []),
          ...(orphanDeltaRows || []).map((d) => d.key),
        ]
      : [];
    const keys = [...featureKeys, ...grpKeys];
    if (!keys.length) return;
    const allOn = keys.every((k) => this._selected.has(k));
    if (allOn) keys.forEach((k) => this._selected.delete(k));
    else keys.forEach((k) => this._selected.add(k));
    this.requestUpdate();
  }

  /**
   * Toggle a group-op or member-delta key with cascading for create ops:
   *
   *  Structural create key selected ON  → also select all its member keys
   *  Structural create key selected OFF → also deselect all its member keys
   *  Member key selected ON (create op) → also select the structural create key
   *  Member key selected OFF            → leave structural key unchanged
   *    (valid to create a group without one of its original members)
   *
   *  Delete ops are atomic: one structural key, no individual member keys.
   */
  _onGrpCellClick(key) {
    const groupOps = this.pendingGroupChanges || [];
    const adding = !this._selected.has(key);

    const structuralMatch = key.match(/^grp_(\d+)$/);
    const memberMatch     = key.match(/^grp_(\d+)_t_(.+)$/);

    if (structuralMatch) {
      const i  = Number(structuralMatch[1]);
      const op = groupOps[i];
      if (op?.type === 'create') {
        const memberKeys = (op.group?.members || []).map((t) => `grp_${i}_t_${t}`);
        if (adding) {
          // Selecting the create row does NOT auto-select members —
          // each member assignment is chosen independently.
          this._selected.add(key);
        } else {
          // Deselecting the create row deselects all members (can't assign to a deleted group).
          this._selected.delete(key);
          memberKeys.forEach((k) => this._selected.delete(k));
        }
        this.requestUpdate();
        return;
      }
    } else if (memberMatch) {
      const i  = Number(memberMatch[1]);
      const op = groupOps[i];
      if (op?.type === 'create' && adding) {
        // Can't assign to a group that isn't being created.
        this._selected.add(key);
        this._selected.add(`grp_${i}`);
        this.requestUpdate();
        return;
      }
    }

    // Default simple toggle (delete, update-field, update-member-delta deselect).
    if (adding) this._selected.add(key);
    else this._selected.delete(key);
    this.requestUpdate();
  }

  /**
   * Resolve a group id to a display name.
   * Checks the GroupService cache first, then create-ops in groupOps.
   */
  _resolveGroupName(id, groupOps) {
    if (!id) return '—';
    const sid = String(id);
    const fromCache = groupService.getGroupById(sid)?.name;
    if (fromCache) return fromCache;
    const fromPending = (groupOps || [])
      .find((op) => op.group?.id && String(op.group.id) === sid)?.group?.name;
    if (fromPending) return fromPending;
    return sid.length > 12 ? `${sid.slice(0, 8)}…` : sid;
  }

  /**
   * Build lookup structures for group changes across all group ops.
   *
   * Returns:
   *   taskGroupMap   — Map<taskId, {opIdx, change, groupName, key}>
   *                    First pending group change per task (for inline display on feature rows).
   *   orphanDeltaRows — [{taskId, opIdx, change, groupName, key}]
   *                    Group changes for tasks with NO other field-change row.
   *
   * Key conventions (all use original groupOps index i):
   *   create members  → grp_${i}_t_${taskId}  (individual; selecting auto-implies the create)
   *   memberDeltas    → grp_${i}_t_${taskId}  (independent)
   *
   * @param {Array}     groupOps   Full pendingGroupChanges array.
   * @param {Set<string>} featureSet  Task IDs that already have a field-change row.
   */
  _buildGroupChangeMaps(groupOps, featureSet) {
    const taskGroupMap = new Map();
    for (const [i, op] of (groupOps || []).entries()) {
      const groupName = op.group?.name ?? this._resolveGroupName(op.groupId, groupOps);
      if (op.type === 'create') {
        for (const taskId of (op.group?.members || []).map(String)) {
          if (!taskGroupMap.has(taskId))
            taskGroupMap.set(taskId, { opIdx: i, change: 'add', groupName, key: `grp_${i}_t_${taskId}` });
        }
      } else if (op.memberDeltas?.length) {
        for (const { taskId, op: change } of op.memberDeltas) {
          const tid = String(taskId);
          if (!taskGroupMap.has(tid))
            taskGroupMap.set(tid, { opIdx: i, change, groupName, key: `grp_${i}_t_${tid}` });
        }
      }
    }
    const orphanDeltaRows = [];
    for (const [taskId, delta] of taskGroupMap.entries()) {
      if (!(featureSet || new Set()).has(taskId))
        orphanDeltaRows.push({ taskId, ...delta });
    }
    return { taskGroupMap, orphanDeltaRows };
  }

  /**
   * Revert all scenario changes for a single feature and remove it from the table.
   * Works even when the feature is no longer visible on the board (e.g. closed in ADO).
   * @param {string} id  Feature / task id
   */
  _onRevertFeature(id) {
    if (!this.state) return;
    // Remove any selected keys for this feature so the selection stays consistent.
    const next = new Set(this._selected);
    for (const key of next) {
      if (key.startsWith(`${id}:`)) next.delete(key);
    }
    this._selected = next;
    // Revert the override in the active scenario (mutates the shared object in place).
    this.state.revertFeature(id);
    // Force re-render so the now-absent override no longer shows a row.
    this.requestUpdate();
  }

  _onSave() {
    // Feature overrides: only selected fields.
    const featuresOut = [];
    for (const [id, ov] of Object.entries(this.overrides || {})) {
      if (!ov || typeof ov !== 'object') continue;
      const out = { id };
      for (const field of FIELDS) {
        if (this._selected.has(`${id}:${field}`) && field in ov) {
          out[field] = ov[field];
        }
      }
      if (Object.keys(out).length > 1) featuresOut.push(out);
    }

    // Group changes — each op type handled independently by original index.
    const groupChanges = (this.pendingGroupChanges || []).reduce((acc, op, i) => {
      if (op.type === 'create') {
        // Structural key must be selected — selecting any member auto-selects it (cascade).
        if (!this._selected.has(`grp_${i}`)) return acc;
        const selectedMembers = (op.group?.members || []).map(String)
          .filter((taskId) => this._selected.has(`grp_${i}_t_${taskId}`));
        acc.push({ ...op, group: { ...op.group, members: selectedMembers } });
      } else if (op.type === 'delete' && this._selected.has(`grp_${i}`)) {
        acc.push(op);
      } else if (op.type === 'update') {
        // Fields (name/color) and member deltas are independently selectable.
        const fieldsSel = op.fields && this._selected.has(`grp_${i}`);
        const selectedDeltas = (op.memberDeltas || []).filter(
          ({ taskId }) => this._selected.has(`grp_${i}_t_${taskId}`)
        );
        if (fieldsSel || selectedDeltas.length > 0) {
          const out = { ...op };
          if (!fieldsSel) delete out.fields;
          if (selectedDeltas.length > 0) out.memberDeltas = selectedDeltas;
          else delete out.memberDeltas;
          acc.push(out);
        }
      }
      return acc;
    }, []);

    this.dispatchEvent(
      new CustomEvent('azure-save', {
        detail: { features: featuresOut, groupChanges },
        bubbles: true,
        composed: true,
      })
    );
    this.remove();
  }

  _onCancel() {
    this.remove();
  }

  // ---------------------------------------------------------------------------
  // Row data computation
  // ---------------------------------------------------------------------------

  /**
   * Compute per-row change metadata from raw override entries.
   * Invalid (non-object) entries are silently filtered out.
   * @param {Array<[string, object]>} entries - [id, override] pairs
   * @returns {Array<object>} rows with change flags and display data
   */
  _computeRows(entries) {
    const normDate = (v) => v || null;
    // Build an id→feature map once so each row lookup is O(1) instead of O(n).
    const baselineById = new Map(
      (this.state?.baselineFeatures || []).map((f) => [f.id, f])
    );
    return entries
      .filter(([, ov]) => ov && typeof ov === 'object')
      .map(([id, ov]) => {
        const base = baselineById.get(id) || {};
        const origStart = base.start || '';
        const origEnd = base.end || '';
        const origCapacity = base.capacity || [];
        const origState = base.state || '';
        const origIterationPath = base.iterationPath || '';
        const origTags = base.tags || '';
        const startChanged = 'start' in ov && normDate(ov.start) !== normDate(origStart);
        const endChanged = 'end' in ov && normDate(ov.end) !== normDate(origEnd);
        const capacityChanged =
          ov.capacity && JSON.stringify(ov.capacity) !== JSON.stringify(origCapacity);
        const stateChanged = ov.state && ov.state !== origState;
        const iterationChanged =
          'iterationPath' in ov && (ov.iterationPath || null) !== (origIterationPath || null);
        const tagsChanged = 'tags' in ov && this._tagsChanged(origTags, ov.tags);

        // Format capacity diff for display
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
          origStart, origEnd, origState, origIterationPath, origTags,
          startChanged, endChanged, capacityChanged, stateChanged, iterationChanged, tagsChanged,
          capacityContent,
        };
      });
  }

  /**
   * @param {Array} enrichedRows   Feature rows enriched with .groupDelta
   * @param {Array} groupOps       Full pendingGroupChanges (original indices for grp_${i} keys)
   * @param {Array} orphanDeltaRows Tasks with only a group change (no field-change row)
   * @param {object} showCols
   */
  _renderTable(enrichedRows, groupOps, orphanDeltaRows, showCols) {
    const { showStart, showEnd, showCapacity, showState, showIteration, showTags, showGroup } = showCols;

    // Clickable changed cell for feature fields.
    const tdFeature = (changed, featureId, field, content) => {
      if (!changed) return html`<td class="unchanged">${content}</td>`;
      const key = `${featureId}:${field}`;
      const sel = this._selected.has(key);
      return html`<td
        class=${sel ? 'changed' : 'changed skipped'}
        @click=${() => this._onCellClick(featureId, field)}
        title=${sel ? 'Click to exclude from this save' : 'Click to include in this save'}
      >${content}</td>`;
    };

    // Column header — clickable when the column has toggleable cells.
    const colHeader = (field, shown) => {
      if (!shown) return '';
      const hasCells = enrichedRows.some((r) => r[CHANGED_KEY[field]]);
      const label = FIELD_LABEL[field];
      return hasCells
        ? html`<th class="col-header" @click=${() => this._onColumnHeaderClick(field, enrichedRows, groupOps, orphanDeltaRows)} title="Click to toggle ${label} column">${label}</th>`
        : html`<th>${label}</th>`;
    };

    // Blank filler cells used in structural-op and orphan rows.
    const blankCells = html`
      ${showStart     ? html`<td class="unchanged"><span style="color:#999">—</span></td>` : ''}
      ${showEnd       ? html`<td class="unchanged"><span style="color:#999">—</span></td>` : ''}
      ${showCapacity  ? html`<td class="unchanged"><span style="color:#999">—</span></td>` : ''}
      ${showState     ? html`<td class="unchanged"><span style="color:#999">—</span></td>` : ''}
      ${showIteration ? html`<td class="unchanged"><span style="color:#999">—</span></td>` : ''}
      ${showTags      ? html`<td class="unchanged"><span style="color:#999">—</span></td>` : ''}
    `;

    // Shared helper: render a group-assignment cell (feature rows and orphan rows).
    const tdGroupDelta = (key, change, groupName) => {
      const groupLabel = change === 'add'
        ? html`— → <strong>${groupName}</strong>`
        : html`<strong>${groupName}</strong> → —`;
      const sel = this._selected.has(key);
      return html`<td
        class=${sel ? 'changed' : 'changed skipped'}
        @click=${() => this._onGrpCellClick(key)}
        title=${sel ? 'Click to exclude from this save' : 'Click to include in this save'}
      ><span style="font-size:0.9em;">${groupLabel}</span></td>`;
    };

    return html`
      <table class="scenario-annotate-table">
        <thead>
          <tr>
            <th style="width:34px;">Sel</th>
            <th>Title</th>
            <th style="width:66px;"></th>
            ${colHeader('start', showStart)}
            ${colHeader('end', showEnd)}
            ${colHeader('capacity', showCapacity)}
            ${colHeader('state', showState)}
            ${colHeader('iterationPath', showIteration)}
            ${colHeader('tags', showTags)}
            ${showGroup ? html`<th class="col-header"
              @click=${() => this._onColumnHeaderClick('groupId', enrichedRows, groupOps, orphanDeltaRows)}
              title="Click to toggle Group column">Group</th>` : ''}
          </tr>
        </thead>
        <tbody>
          ${enrichedRows.map((r) => html`
            <tr>
              ${(() => {
                const rowKeys = this._getFeatureRowKeys(r);
                return html`<td>
                  <input
                    type="checkbox"
                    .checked=${this._isAllSelected(rowKeys)}
                    ?disabled=${rowKeys.length === 0}
                    @change=${() => this._onRowToggle(rowKeys)}
                    title="Toggle all changes on this row"
                  />
                </td>`;
              })()}
              <td>
                ${this.state ? this.state.getFeatureTitleById(r.id) : r.id}
              </td>
              <td style="padding:6px 8px;">
                <button
                  type="button"
                  class="revert-btn"
                  title="Discard all local changes for this item"
                  @click=${() => this._onRevertFeature(r.id)}
                >↺ Revert</button>
              </td>
              ${showStart ? tdFeature(r.startChanged, r.id, 'start',
                  this._formatRange(r.origStart, r.ov.start)) : ''}
              ${showEnd ? tdFeature(r.endChanged, r.id, 'end',
                  this._formatRange(r.origEnd, r.ov.end)) : ''}
              ${showCapacity ? tdFeature(r.capacityChanged, r.id, 'capacity',
                  r.capacityChanged
                    ? html`<span style="font-size:0.9em;line-height:1.4;">${r.capacityContent}</span>`
                    : html`<span style="font-size:0.9em;">—</span>`) : ''}
              ${showState ? tdFeature(r.stateChanged, r.id, 'state',
                  r.stateChanged
                    ? html`<span style="font-size:0.9em;">${r.origState || '—'} → <strong>${r.ov.state}</strong></span>`
                    : html`<span style="font-size:0.9em;">${r.origState || '—'}</span>`) : ''}
              ${showIteration ? tdFeature(r.iterationChanged, r.id, 'iterationPath',
                  r.iterationChanged
                    ? html`<span style="font-size:0.9em;">
                        ${r.origIterationPath || '—'} →
                        <strong>${r.ov.iterationPath || html`<em style="color:#c0392b">(cleared)</em>`}</strong>
                      </span>`
                    : html`<span style="font-size:0.9em;">${r.origIterationPath || '—'}</span>`) : ''}
              ${showTags ? tdFeature(r.tagsChanged, r.id, 'tags',
                  html`<span style="font-size:0.9em;line-height:1.4;">${this._formatTagsRange(r.origTags, r.ov.tags)}</span>`) : ''}
              ${showGroup
                ? (r.groupDelta
                    ? tdGroupDelta(r.groupDelta.key, r.groupDelta.change, r.groupDelta.groupName)
                    : html`<td class="unchanged"><span style="color:#999">—</span></td>`)
                : ''}
            </tr>
          `)}
          ${
            (groupOps || []).flatMap((op, i) => {
              if (!isStructuralOp(op)) return [];
              const resolvedGroup = op.group
                ?? (op.groupId ? groupService.getGroupById(String(op.groupId)) : null);
              const planId = resolvedGroup?.plan_id || op.planId;
              const planName = planId
                ? (this.state?.projects?.find((p) => String(p.id) === String(planId))?.name ?? planId)
                : '';
              const grpName = op.group?.name ?? this._resolveGroupName(op.groupId, groupOps);
              const itemLabel = planName
                ? `Group '${grpName}' in ${planName}`
                : `Group '${grpName}'`;
              const actionLabel =
                op.type === 'create' ? html`<span style="color:#0a7c42;font-weight:600;">created</span>` :
                op.type === 'delete' ? html`<span style="color:#c0392b;font-weight:600;">deleted</span>` :
                html`renamed to '<strong>${op.fields?.name ?? '?'}</strong>'`;
              const key = `grp_${i}`;
              const sel = this._selected.has(key);
              return [html`
                <tr>
                  <td>
                    <input
                      type="checkbox"
                      .checked=${sel}
                      @change=${() => this._onRowToggle([key])}
                      title="Toggle all changes on this row"
                    />
                  </td>
                  <td>${itemLabel}</td>
                  <td></td>
                  ${blankCells}
                  ${showGroup ? html`<td
                    class=${sel ? 'changed' : 'changed skipped'}
                    @click=${() => this._onGrpCellClick(key)}
                    title=${sel ? 'Click to exclude from this save' : 'Click to include in this save'}
                  >${actionLabel}</td>` : ''}
                </tr>`];
            })
          }
          ${
            /* Orphan rows: tasks with only a group change (no feature-field row above) */
            (orphanDeltaRows || []).map((d) => html`
              <tr>
                <td>
                  <input
                    type="checkbox"
                    .checked=${this._selected.has(d.key)}
                    @change=${() => this._onRowToggle([d.key])}
                    title="Toggle all changes on this row"
                  />
                </td>
                <td>${this.state ? this.state.getFeatureTitleById(d.taskId) : d.taskId}</td>
                <td style="padding:6px 8px;">
                  <button
                    type="button"
                    class="revert-btn"
                    title="Discard all local changes for this item"
                    @click=${() => this._onRevertFeature(d.taskId)}
                  >↺ Revert</button>
                </td>
                ${blankCells}
                ${showGroup ? tdGroupDelta(d.key, d.change, d.groupName) : ''}
              </tr>
            `)
          }
        </tbody>
      </table>`;
  }

  render() {
    const groupOps = this.pendingGroupChanges || [];

    // Compute feature-field rows.
    const allRows = this._computeRows(Object.entries(this.overrides || {}));
    const featureRows = allRows.filter((r) =>
      r.startChanged || r.endChanged || r.capacityChanged || r.stateChanged || r.iterationChanged || r.tagsChanged
    );
    const featureSet = new Set(featureRows.map((r) => r.id));

    // Build group-change maps; enrich feature rows with inline group delta.
    const { taskGroupMap, orphanDeltaRows } = this._buildGroupChangeMaps(groupOps, featureSet);
    const enrichedRows = featureRows.map((r) => ({ ...r, groupDelta: taskGroupMap.get(r.id) || null }));

    const showStart     = enrichedRows.some((r) => r.startChanged);
    const showEnd       = enrichedRows.some((r) => r.endChanged);
    const showCapacity  = enrichedRows.some((r) => r.capacityChanged);
    const showState     = enrichedRows.some((r) => r.stateChanged);
    const showIteration = enrichedRows.some((r) => r.iterationChanged);
    const showTags      = enrichedRows.some((r) => r.tagsChanged);
    const showGroup     = groupOps.length > 0;
    const showCols = { showStart, showEnd, showCapacity, showState, showIteration, showTags, showGroup };

    const hasAny = enrichedRows.length > 0 || groupOps.length > 0;

    return html`
      <modal-lit wide>
        <div slot="header"><h3>Review and save changes</h3></div>
        <div>
          <style>
            p {
              margin: 0 0 16px 0;
              color: #333;
              font-size: 14px;
            }
            p.instruction {
              font-size: 12px;
              color: #666;
              margin: 0 0 8px 0;
              font-style: italic;
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
            .scenario-annotate-table th.col-header {
              cursor: pointer;
              user-select: none;
            }
            .scenario-annotate-table th.col-header:hover {
              background: #e8e8e8;
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
            /* Changed and selected for persistence — yellow accent */
            .scenario-annotate-table td.changed {
              background: #fffbe6;
              border-left: 3px solid #e6a817;
              cursor: pointer;
            }
            /* Changed but deselected — will not be persisted this save */
            .scenario-annotate-table td.changed.skipped {
              background: #f0f0f0;
              border-left: 3px solid #bbb;
              color: #999;
              text-decoration: line-through;
              cursor: pointer;
            }
            .scenario-annotate-table td.changed:hover {
              filter: brightness(0.96);
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
            .scenario-annotate-table strong {
              color: #000;
              font-weight: 600;
            }
            .revert-btn {
              display: inline-flex;
              align-items: center;
              gap: 4px;
              padding: 3px 7px;
              border: 1px solid rgba(192,57,43,0.30);
              border-radius: 5px;
              background: transparent;
              color: #a93226;
              font-size: 11px;
              cursor: pointer;
              white-space: nowrap;
              line-height: 1.4;
            }
            .revert-btn:hover {
              background: rgba(192,57,43,0.07);
              border-color: rgba(192,57,43,0.55);
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
              <p class="instruction">Select rows and/or cells to save by clicking a row checkbox or cell. Click a column header to toggle the whole column. Use the revert button to revert all changes to that task.</p>
              <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
                <button type="button" @click=${() => this._toggleAll(enrichedRows, groupOps, orphanDeltaRows)} class="btn">
                  Toggle All/None
                </button>
              </div>
              <div style="max-height:60vh;overflow-y:auto;padding-right:8px;">
                ${this._renderTable(enrichedRows, groupOps, orphanDeltaRows, showCols)}
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
