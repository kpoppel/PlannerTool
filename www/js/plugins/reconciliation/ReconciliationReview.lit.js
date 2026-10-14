import { LitElement, html, css, repeat } from '../../vendor/lit.js';
import { cmd, sel } from '../../application/imports.js';
import { dataService } from '../../services/dataService.js';
import { bus } from '../../core/EventBus.js';
import { PluginEvents, UIEvents } from '../../core/EventRegistry.js';
import { findInBoard } from '../../components/board-utils.js';
import { SIDEBAR_STYLES } from '../../components/sidebar/Sidebar.styles.lit.js';
import { reconciliation } from './runtime.js';
import { categoryCounts, changeLabel, statusText, taskLabel, projectLabel,
  findingExplanation } from './presentation.js';

let review = null;

export function isReconciliationReviewOpen() {
  return review !== null;
}

export function toggleReconciliationReview() {
  if (review !== null) {
    review.close();
  } else {
    const category = categoryCounts(reconciliation.snapshot).find((entry) => entry.count > 0);
    openReconciliationReview(category === undefined ? 'quality' : category.id);
  }
}

export function openReconciliationReview(category = 'quality', selectedId = null) {
  if (review) {
    if (review.category !== category || review.selectedId !== selectedId) {
      review._selectedIssueType = null;
      review.selectedIssueId = null;
    }
    review.category = category;
    review.selectedId = selectedId;
    if (selectedId !== null) {
      review.query = '';
      review._taskRevealRevision++;
    }
    review.toolboxHidden = false;
    return;
  }
  review = document.createElement('reconciliation-review');
  review.category = category;
  review.selectedId = selectedId;
  if (selectedId !== null) review._taskRevealRevision++;
  document.body.appendChild(review);
}

export function closeReconciliationReview() {
  if (review) review.close();
}

export class ReconciliationReview extends LitElement {
  static properties = { snapshot: { state: true }, category: { state: true },
    query: { state: true }, selectedId: { state: true },
    _selectedIssueType: { state: true }, selectedIssueId: { state: true },
    contextMode: { state: true }, presentationError: { state: true },
    _stateChoices: { state: true },
    _impactReview: { state: true }, _linkChoice: { state: true }, actionError: { state: true },
    _locateRevision: { state: true }, _taskRevealRevision: { state: true },
    reviewView: { state: true }, _exceptionReasons: { state: true }, _accepting: { state: true },
    toolboxHidden: { state: true } };

  static styles = [SIDEBAR_STYLES, css`
    :host { position: fixed; top: 40px; left: 0; bottom: var(--app-footer-height, 64px);
      width: var(--sidebar-width, 240px); z-index: var(--z-reconciliation, 110);
      pointer-events: none; color: var(--color-sidebar-text, white); font-family: inherit; }
    .toolbox { height: 100%; display: flex; flex-direction: column; pointer-events: auto;
      background: var(--color-sidebar-bg, #294a43); box-sizing: border-box; }
    .toolbox[hidden] { display: none; }
    .edge { position: absolute; left: 100%; top: 4px; width: 28px; height: 32px;
      padding: 0; pointer-events: auto; font-size: 22px; }
    .edge, .edge:hover { background: var(--color-sidebar-bg, #294a43); }
    header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    h2 { font-size: 14px; margin: 0; } h3 { font-size: 14px; margin: 0 0 8px; }
    header .scenario-name { flex: 1; text-align: right; font-size: 12px; overflow-wrap: anywhere; min-width: 0; }
    p { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    button, input, select, textarea { font: inherit; font-size: 13px; border: 1px solid #b8c2c8;
      border-radius: 4px; color: inherit; background: transparent; padding: 8px 10px; }
    button { cursor: pointer; } button:hover { background: #ffffff20; }
    button:disabled { color: #78848b; background: #f4f6f7; border-color: #d7dde0; cursor: default; }
    button:focus-visible, input:focus-visible { outline: 2px solid #8ec8ff; outline-offset: 2px; }
    select { width: 100%; color: #23344d; background: white; box-sizing: border-box; }
    select:focus-visible { outline: 2px solid #8ec8ff; outline-offset: 2px; }
    .fix-actions label { display: block; font-size: 12px; }
    .fix-actions select { margin-top: 6px; }
    .exception-actions { border-top: 1px solid rgba(255,255,255,.25); margin-top: 12px; padding-top: 8px; }
    .exception-actions label { display: block; font-size: 12px; }
    textarea { display: block; width: 100%; box-sizing: border-box; resize: vertical;
      margin: 6px 0; min-height: 64px; }
    textarea:focus-visible { outline: 2px solid #8ec8ff; outline-offset: 2px; }
    .exception-entry { border-top: 1px solid rgba(255,255,255,.25); padding: 10px 0; }
    .accepted-status { font-weight: 600; }
    .impact-review { border-left: 3px solid #8ec8ff; padding-left: 8px; margin-top: 12px; }
    .filters { display: grid; gap: 12px; margin: 6px; flex-shrink: 0; }
    .category { min-height: 48px; }
    .category .count { display: block; font-variant-numeric: tabular-nums; margin-top: 4px; }
    input[type='search'] { width: 100%; min-width: 0; box-sizing: border-box; }
    .workspace { flex: 1; overflow: auto; min-height: 0; padding: 0 6px 6px; }
    .list { margin-bottom: 0; }
    .issue-class, .resolved-task { border-top: 1px solid rgba(255,255,255,.15); padding: 10px 0; }
    .issue-class > summary { display: flex; align-items: baseline; gap: 6px; }
    .issue-class > summary::before { content: '\u203a'; }
    .issue-class[open] > summary::before { content: '\u2304'; }
    .issue-class > summary .count { margin-left: auto; }
    .issue-class > summary::-webkit-details-marker { display: none; }
    .task { margin-top: 8px; }
    .task-detail { padding: 0 6px 8px; }
    summary { cursor: pointer; font-size: 13px; font-weight: 600; line-height: 1.5;
      overflow-wrap: anywhere; }
    summary:focus-visible { outline: 2px solid #167d69; outline-offset: 2px; }
    .item { display: block; width: 100%; text-align: left; margin-bottom: 8px; overflow-wrap: anywhere; }
    .item[aria-pressed='true'] { border-color: #8ec8ff; background: #ffffff20; }
    .item strong, .item small { display: block; line-height: 1.5; }
    .section-title { display: flex; align-items: center; gap: 6px; }
    .section-icon { width: 18px; flex: 0 0 18px; font-size: 16px; text-align: center; }
    .group-label { margin-bottom: 6px; }
    .marker-toggle { justify-self: start; padding: 4px 10px; border-radius: 16px;
      border-color: rgba(255,255,255,.25); background: rgba(255,255,255,.08); }
    .marker-toggle[aria-pressed='true'] { background: #fff; color: #23344d; border-color: #fff; }
    .muted { opacity: 0.8; font-size: 12px; }
    .relationship { border-top: 1px solid #ddd; padding: 12px 0; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
    dl { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 6px; font-size: 12px; }
    dt { opacity: 0.8; } dd { margin: 0; overflow-wrap: anywhere; }
  `];

  constructor() {
    super();
    this.snapshot = reconciliation.snapshot;
    this.category = 'quality';
    this.query = '';
    this.selectedId = null;
    this._selectedTask = null;
    this._selectedIssueType = null;
    this.selectedIssueId = null;
    this.contextMode = 'relevant';
    this._stateChoices = new Map();
    this._impactReview = null;
    this._linkChoice = '';
    this.actionError = '';
    this.presentationError = '';
    this._contextBoard = null;
    this._contextSignature = 'null';
    this._reviewFeatureIds = new Set();
    this._presentationGeneration = 0;
    this._presentationComplete = Promise.resolve();
    this._locateRevision = 0;
    this._taskRevealRevision = 0;
    this.toolboxHidden = false;
    this.reviewView = 'findings';
    this._exceptionReasons = new Map();
    this._accepting = null;
  }

  connectedCallback() {
    super.connectedCallback();
    review = this;
    this._returnFocus = document.activeElement;
    while (this._returnFocus.shadowRoot && this._returnFocus.shadowRoot.activeElement) {
      this._returnFocus = this._returnFocus.shadowRoot.activeElement;
    }
    this.snapshot = reconciliation.snapshot;
    this._unsubscribe = reconciliation.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this._stateChoices = new Map();
      this._impactReview = null;
      this._linkChoice = '';
      this._exceptionReasons = new Map();
    });
    bus.emit(PluginEvents.MENU_STATUS_CHANGED, { id: 'plugin-reconciliation' });
  }

  disconnectedCallback() {
    this._unsubscribe();
    this._presentationGeneration++;
    reconciliation.setReviewFeatureId(null);
    if (this._contextBoard !== null) {
      this._presentationComplete = this._contextBoard.setReconciliationContext(null);
      this._presentationComplete.catch((error) => this._onPresentationError(error));
      this._contextBoard = null;
      this._contextSignature = 'null';
    }
    if (review === this) review = null;
    bus.emit(PluginEvents.MENU_STATUS_CHANGED, { id: 'plugin-reconciliation' });
    super.disconnectedCallback();
  }

  firstUpdated() {
    this.shadowRoot.querySelector('.category').focus();
  }

  updated(changes) {
    // Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
    if (!this.isConnected) return;
    const selected = this.snapshot.groups.find((group) => group.id === this.selectedId);
    if (selected !== undefined) {
      this._selectedTask = { id: selected.id, category: selected.category, featureId: selected.featureId };
    }
    const retained = this._selectedTask !== null && this._selectedTask.id === this.selectedId;
    reconciliation.setReviewFeatureId(retained ? this._selectedTask.featureId : null);
    if (changes.has('_taskRevealRevision') && this.selectedId !== null) {
      this._scrollSelectedTaskIntoView();
    }
    const locate = ['selectedId', 'category', '_selectedIssueType', 'selectedIssueId', 'contextMode',
      '_locateRevision', '_taskRevealRevision']
      .some((property) => changes.has(property));
    const previous = changes.get('snapshot');
    const refresh = previous !== undefined && previous.featuresById !== this.snapshot.featuresById;
    if (locate || changes.has('snapshot')) {
      this._presentationComplete = this._applyBoardContext(locate, refresh);
      this._presentationComplete.catch((error) => this._onPresentationError(error));
    }
  }

  _onPresentationError(error) {
    console.error('[ReconciliationReview] Board context failed', { selectedId: this.selectedId, error });
    this.presentationError = 'Could not display the selected task on the board.';
  }

  _scrollSelectedTaskIntoView() {
    const selected = this.shadowRoot.querySelector('.item[aria-pressed="true"]');
    // Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
    if (selected === null) return;
    const workspace = this.shadowRoot.querySelector('.workspace');
    workspace.scrollTop = Math.max(0, workspace.scrollTop
      + selected.getBoundingClientRect().top - workspace.getBoundingClientRect().top - 8);
  }

  async _applyBoardContext(locate, refresh) {
    let group = this.snapshot.groups.find((entry) => entry.id === this.selectedId);
    if (group === undefined && this._selectedTask !== null && this._selectedTask.id === this.selectedId) {
      group = { ...this._selectedTask, issues: [] };
    }
    let context = null;
    if (group !== undefined && this.snapshot.status === 'ready'
      && this.snapshot.featuresById.has(group.featureId)) {
      const featureIds = new Set([group.featureId]);
      let issue = group.issues.find((entry) => entry.id === this.selectedIssueId);
      if (issue === undefined) issue = group.issues.find((entry) => entry.type === this._selectedIssueType);
      if (issue === undefined) issue = group.issues[0];
      if (issue !== undefined) {
        for (const id of [...issue.path, issue.relatedId]) {
          if (id !== null && this.snapshot.featuresById.has(id)) featureIds.add(id);
        }
      } else {
        for (const id of this._reviewFeatureIds) {
          if (this.snapshot.featuresById.has(id)) featureIds.add(id);
        }
      }
      for (const id of featureIds) {
        const feature = this.snapshot.featuresById.get(id);
        if (feature.parentId !== null && this.snapshot.featuresById.has(String(feature.parentId))) {
          featureIds.add(String(feature.parentId));
        }
      }
      this._reviewFeatureIds = featureIds;
      context = { filter: group.category === 'schedule' && this.contextMode === 'relevant', featureIds };
    }
    if (context === null && this._contextBoard === null) return;
    const board = findInBoard('feature-board');
    // Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
    if (board === null) return;
    const signature = context === null ? 'null'
      : JSON.stringify([context.filter, [...context.featureIds].sort()]);
    if (!locate && !refresh && board === this._contextBoard && signature === this._contextSignature) return;
    const generation = ++this._presentationGeneration;
    if (board !== this._contextBoard || signature !== this._contextSignature || refresh) {
      this._contextBoard = board;
      this._contextSignature = signature;
      await board.setReconciliationContext(context);
    } else if (locate) {
      await board.updateComplete;
    }
    if (locate && context !== null && generation === this._presentationGeneration && this.isConnected) {
      await board.centerFeatureById(group.featureId);
    }
  }

  _onSelectTask(group, issueType) {
    this.selectedId = group.id;
    this._selectedIssueType = issueType;
    this.selectedIssueId = group.issues.find((issue) => issue.type === issueType).id;
    this._locateRevision++;
  }

  _onSelectIssue(issue) {
    this.selectedIssueId = issue.id;
    this._locateRevision++;
  }

  close() {
    this.remove();
    if (this._returnFocus.isConnected) this._returnFocus.focus();
  }

  _onToggleToolbox() {
    if (!this.toolboxHidden && this.shadowRoot.activeElement) {
      this.shadowRoot.querySelector('.edge').focus();
    }
    this.toolboxHidden = !this.toolboxHidden;
  }

  _onTaskOpen(featureId) {
    const feature = this.snapshot.featuresById.get(featureId);
    if (!feature) throw new Error(`Cannot open unloaded task ${featureId}`);
    cmd.feature.setSelectedFeature(feature);
    bus.emit(UIEvents.DETAILS_SHOW);
  }

  _onLocate(featureId) {
    findInBoard('feature-board').centerFeatureById(featureId);
  }

  _renderDates(featureId) {
    const feature = this.snapshot.featuresById.get(featureId);
    if (!feature) return html`<p>Task data unavailable.</p>`;
    const source = this.snapshot.sourceById.get(featureId);
    const dates = (task) => `${task.start ? task.start : 'Unplanned'} to ${task.end ? task.end : 'Unplanned'}`;
    return html`<dl>
      <dt>Owning plan</dt><dd>${projectLabel(this.snapshot, featureId)}</dd>
      <dt>Effective dates</dt><dd>${dates(feature)}</dd>
      ${source ? html`<dt>Source dates</dt><dd>${dates(source)}</dd>` : ''}
    </dl>`;
  }

  _stateOptions(issue) {
    const requiredGroup = issue.type === 'future-active' ? 'Proposed'
      : ['past-unfinished', 'parent-state'].includes(issue.type) ? 'Completed' : null;
    if (requiredGroup === null) return [];
    const feature = this.snapshot.featuresById.get(issue.featureId);
    const project = this.snapshot.projectsById.get(String(feature.project));
    if (project === undefined) return [];
    return Object.entries(project.state_categories)
      .filter(([, group]) => group === requiredGroup).map(([state]) => state);
  }

  _requireEditable() {
    if (sel.scenario.getActiveScenario().readonly === true) {
      throw new Error('Cannot correct a read-only scenario');
    }
  }

  _actionContext(issue) {
    const ids = new Set([issue.featureId, ...issue.path]);
    const feature = this.snapshot.featuresById.get(issue.featureId);
    if (feature.parentId !== null) ids.add(String(feature.parentId));
    for (const relation of feature.relations) ids.add(String(relation.id));
    for (const related of this.snapshot.featuresById.values()) {
      if (String(related.parentId) === issue.featureId
        || related.relations.some((relation) => String(relation.id) === issue.featureId)) {
        ids.add(String(related.id));
      }
    }
    return [...ids];
  }

  _hasCrossPlanImpact(issue) {
    const feature = this.snapshot.featuresById.get(issue.featureId);
    return this._actionContext(issue).some((id) => {
      const related = this.snapshot.featuresById.get(id);
      return related === undefined || String(related.project) !== String(feature.project);
    });
  }

  _dependencyLinks(issue) {
    if (!['dependency-order', 'unavailable-dependency', 'unavailable-dependency-dates'].includes(issue.type)) return [];
    const links = [];
    for (const ownerId of issue.path) {
      const owner = this.snapshot.featuresById.get(ownerId);
      if (owner === undefined) continue;
      owner.relations.forEach((relation, index) => {
        const matches = issue.type === 'unavailable-dependency'
          ? ownerId === issue.featureId && String(relation.id) === issue.relatedId
            && issue.id === `unavailable-dependency:${ownerId}:${relation.type}:${relation.id}`
          : (ownerId === issue.featureId && relation.type === 'Predecessor'
            && String(relation.id) === issue.relatedId)
            || (ownerId === issue.relatedId && relation.type === 'Successor'
              && String(relation.id) === issue.featureId);
        if (matches) {
          links.push({ ownerId, relation, index });
        }
      });
    }
    return links;
  }

  _onApplyState(issue) {
    this._requireEditable();
    const state = this._stateChoices.get(issue.id);
    if (!this.snapshot.issues.some((current) => current.id === issue.id)
      || !this._stateOptions(issue).includes(state)) {
      throw new Error('Choose a configured state for the current finding');
    }
    if (this._hasCrossPlanImpact(issue)
      && (this._impactReview === null || this._impactReview.issueId !== issue.id
        || this._impactReview.kind !== 'state')) {
      this._onEdit(issue, 'state');
      return;
    }
    cmd.feature.updateFeatureField(issue.featureId, 'state', state);
  }

  _onEdit(issue, kind) {
    this.selectedIssueId = issue.id;
    this._impactReview = { issueId: issue.id, kind };
    this._linkChoice = '';
    this.actionError = '';
  }

  async _onContinueEdit(issue) {
    this._requireEditable();
    if (!this.snapshot.issues.some((current) => current.id === issue.id)
      || this._impactReview === null || this._impactReview.issueId !== issue.id) {
      throw new Error('Review the current finding before editing');
    }
    if (this._impactReview.kind === 'state') {
      this._onApplyState(issue);
      return;
    }
    try {
      this._onTaskOpen(issue.featureId);
      const panel = document.querySelector('details-panel');
      if (panel === null) throw new Error('Task editor is not mounted');
      await panel.focusSchedulingEditor();
    } catch (error) {
      console.error('[ReconciliationReview] Task editor failed', { issueId: issue.id, error });
      this.actionError = 'Could not open the task editor.';
    }
  }

  _onRemoveDependency(issue) {
    this._requireEditable();
    if (this._impactReview === null || this._impactReview.issueId !== issue.id
      || this._impactReview.kind !== 'dependency' || this._linkChoice === ''
      || !this.snapshot.issues.some((current) => current.id === issue.id)) {
      throw new Error('Choose a recorded dependency in the current impact review');
    }
    const link = this._dependencyLinks(issue)[Number(this._linkChoice)];
    if (link === undefined) throw new Error('Recorded dependency is no longer available');
    const owner = this.snapshot.featuresById.get(link.ownerId);
    cmd.feature.updateFeatureField(link.ownerId, 'relations',
      owner.relations.filter((relation, index) => index !== link.index));
  }

  _renderImpactReview(issue, readonly) {
    if (this._impactReview === null || this._impactReview.issueId !== issue.id) return '';
    const kind = this._impactReview.kind;
    const links = this._dependencyLinks(issue);
    const link = this._linkChoice === '' ? undefined : links[Number(this._linkChoice)];
    return html`<section class="impact-review" aria-label="Correction impact review">
      <h3>Impact review</h3>
      <p>${kind === 'dates' ? 'Review start and finish dates in Scheduling. The existing date editor can shift children and extend direct parent bounds; no dates change when opening it.'
        : kind === 'state' ? 'State correction affects related work; related task fields will not change.'
          : 'Remove only a recorded dependency that is incorrect. Removing a link does not reschedule either task; reciprocal links remain until separately reviewed.'}</p>
      <dl><dt>Related work</dt><dd>${this._actionContext(issue).map((id) =>
        `${taskLabel(this.snapshot, id)} (${projectLabel(this.snapshot, id)})`).join('; ')}</dd></dl>
      ${kind === 'dependency' ? html`
        <label>Recorded dependency
          <select data-link-choice aria-label="Recorded dependency" ?disabled=${readonly}
            .value=${this._linkChoice} @change=${(event) => { this._linkChoice = event.target.value; }}>
            <option value="">Choose recorded link</option>
            ${links.map((entry, index) => html`<option value=${String(index)}>
              ${taskLabel(this.snapshot, entry.ownerId)}: ${entry.relation.type} ${taskLabel(this.snapshot, entry.relation.id)}
            </option>`)}
          </select>
        </label>
        <p class="link-preview">${link === undefined ? 'No link selected.' :
          `Remove ${link.relation.type} ${taskLabel(this.snapshot, link.relation.id)} from ${taskLabel(this.snapshot, link.ownerId)} in ${projectLabel(this.snapshot, link.ownerId)}.`}
          Changes only the selected link in ${this.snapshot.scenarioName}; does not publish.</p>
        <button data-action="remove-dependency" ?disabled=${readonly || link === undefined}
          @click=${() => this._onRemoveDependency(issue)}>Remove reviewed dependency</button>` : html`
        <button data-action="continue-edit" ?disabled=${readonly}
          @click=${() => this._onContinueEdit(issue)}>${kind === 'state' ? 'Apply reviewed state' : 'Open Scheduling'}</button>`}
      <button data-action="cancel-impact" @click=${() => { this._impactReview = null; }}>Cancel</button>
    </section>`;
  }

  _renderFixActions(issue) {
    const states = this._stateOptions(issue);
    const feature = this.snapshot.featuresById.get(issue.featureId);
    const selected = this._stateChoices.get(issue.id);
    const readonly = sel.scenario.getActiveScenario().readonly === true;
    const dates = ['invalid-dates', 'past-unfinished', 'future-active', 'unplanned-child',
      'containment', 'dependency-order', 'unavailable-containment-dates',
      'unavailable-dependency-dates'].includes(issue.type);
    const links = this._dependencyLinks(issue);
    return html`<div class="fix-actions">
      ${readonly && (states.length > 0 || dates || links.length > 0) ? html`<p>Read-only scenario. Choose an editable scenario to apply corrections.</p>` : ''}
      ${states.length > 0 ? html`<label>Task state
        <select data-state-choice aria-label="Configured task state" ?disabled=${readonly}
          .value=${selected === undefined ? '' : selected}
          @change=${(event) => {
            this._stateChoices = new Map(this._stateChoices).set(issue.id, event.target.value);
            this._impactReview = null;
          }}>
          <option value="">Choose state</option>
          ${states.map((state) => html`<option value=${state}>${state}</option>`)}
        </select>
      </label>
      <p class="action-preview">${taskLabel(this.snapshot, issue.featureId)} in
        ${projectLabel(this.snapshot, issue.featureId)}:
        ${feature.state} ${'\u2192'} ${selected === undefined || selected === '' ? 'choose state' : selected}.
        Changes only this task's state in ${this.snapshot.scenarioName}; does not publish.</p>
      <button data-action="apply-state" ?disabled=${readonly || !states.includes(selected)}
        @click=${() => this._onApplyState(issue)}>${this._hasCrossPlanImpact(issue) ? 'Review state impact' : 'Set task state'}</button>` : ''}
      ${states.length === 0 && ['past-unfinished', 'future-active', 'parent-state'].includes(issue.type)
        ? html`<p>No configured state in the required ${issue.type === 'future-active' ? 'Proposed' : 'Completed'} group.</p>` : ''}
      <div class="actions">
        ${dates ? html`<button data-action="edit-dates" ?disabled=${readonly}
          @click=${() => this._onEdit(issue, 'dates')}>Edit dates</button>` : ''}
        ${links.length > 0 ? html`<button data-action="edit-dependency" ?disabled=${readonly}
          @click=${() => this._onEdit(issue, 'dependency')}>Edit dependency</button>` : ''}
      </div>
      ${this._renderImpactReview(issue, readonly)}
      ${this.actionError !== '' ? html`<p role="alert">${this.actionError}</p>` : ''}
    </div>`;
  }

  _renderTaskDetails(current, issueType = null, issueId = null) {
    const selectedIssues = current.issues.filter((issue) => issue.type === issueType
      && (issueId === null || issue.id === issueId));
    const remaining = this.snapshot.issues.filter((issue) => issue.featureId === current.featureId).length;
    return html`<div class="task-detail">
      ${this._renderDates(current.featureId)}
      ${selectedIssues.length === 0 ? html`<p role="status">${remaining === 0
        ? 'No remaining findings for this task in the current review scope.'
        : `Selected finding resolved. ${remaining} other ${remaining === 1 ? 'finding remains' : 'findings remain'} for this task.`}</p>` : ''}
      <div class="actions">
        <button data-action="open-task"
          title=${`Open ${taskLabel(this.snapshot, current.featureId)} in ${projectLabel(this.snapshot, current.featureId)}; opening does not change task data.`}
          @click=${() => this._onTaskOpen(current.featureId)}>Open task</button>
        <button data-action="locate-task"
          @click=${() => this._onLocate(current.featureId)}>Locate on board</button>
      </div>
      ${selectedIssues
        .map((issue) => {
          const explanation = findingExplanation(this.snapshot, issue);
          return html`<details class="relationship"
        data-issue-type=${issue.type} open>
        <summary @click=${() => this._onSelectIssue(issue)}>${issue.title}</summary>
        <p>${issue.description}</p>
        <dl>
          <dt>Constraint</dt><dd>${explanation.constraint}</dd>
          <dt>Owning plan</dt><dd>${projectLabel(this.snapshot, issue.featureId)}</dd>
          <dt>Related work</dt><dd>${issue.path.map((id) => taskLabel(this.snapshot, id)).join(' / ')}</dd>
          <dt>Affected plans</dt><dd>${explanation.affectedPlans.join(', ')}</dd>
          ${issue.change !== undefined ? html`<dt>Change</dt><dd>${changeLabel(issue.change)}</dd>` : ''}
          ${issue.severity === 'info' ? html`<dt>Assessment</dt><dd>Cannot assess</dd>` : ''}
          ${issue.category === 'schedule' && issue.severity !== 'info' ? html`
            <dt>Drift</dt><dd>${issue.earlyDays} days early / ${issue.lateDays} days late</dd>` : ''}
          <dt>Impact</dt><dd>${explanation.impact} Opening or locating tasks does not change task data.</dd>
        </dl>
        ${this._renderFixActions(issue)}
        ${this._renderExceptionActions(issue)}
        ${issue.relatedId !== null && this.snapshot.featuresById.has(issue.relatedId) ? html`
          ${this._renderDates(issue.relatedId)}
          <div class="actions">
            <button title=${`Open ${taskLabel(this.snapshot, issue.relatedId)} in ${projectLabel(this.snapshot, issue.relatedId)}; opening does not change task data.`}
              @click=${() => this._onTaskOpen(issue.relatedId)}>Open related task</button>
            <button
              @click=${() => this._onLocate(issue.relatedId)}>Locate related task</button>
          </div>` : ''}
      </details>`;
        })}
    </div>`;
  }

  async _onAcceptException(issue) {
    this._requireEditable();
    const scenarioId = sel.scenario.getActiveScenario().id;
    const evidence = this.snapshot.featuresById;
    const reason = this._exceptionReasons.get(issue.id);
    this._accepting = issue.id;
    this.actionError = '';
    try {
      const actor = await dataService.getLocalPref('user.email');
      // Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.
      if (typeof actor !== 'string' || actor.trim() === '') {
        throw new Error('Sign in before accepting an exception');
      }
      if (sel.scenario.getActiveScenario().id !== scenarioId || this.snapshot.featuresById !== evidence) {
        throw new Error('Finding changed while accepting; review it again');
      }
      reconciliation.acceptException(issue.id, { actor, reason });
    } catch (error) {
      console.error('[ReconciliationReview] Acceptance failed', { issueId: issue.id, error });
      this.actionError = error.message;
    } finally {
      this._accepting = null;
    }
  }

  _renderExceptionActions(issue) {
    if (issue.severity === 'info') return '';
    const readonly = sel.scenario.getActiveScenario().readonly === true;
    const decision = issue.acceptance;
    const reason = this._exceptionReasons.get(issue.id);
    return html`<section class="exception-actions" aria-label="Exception decision">
      ${decision === null ? html`
        <label>Reason for exception
          <textarea data-exception-reason aria-label="Reason for exception" rows="2"
            ?disabled=${readonly} .value=${reason === undefined ? '' : reason}
            @input=${(event) => {
              this._exceptionReasons = new Map(this._exceptionReasons).set(issue.id, event.target.value);
            }}></textarea>
        </label>
        <button data-action="accept-exception"
          ?disabled=${readonly || reason === undefined || reason.trim() === '' || this._accepting !== null}
          @click=${() => this._onAcceptException(issue)}>Accept exception</button>` : html`
        <p class="accepted-status">Accepted exception: ${decision.status === 'pending'
          ? 'Acceptance not saved' : 'Saved in this scenario'}</p>
        <p>${decision.reason}</p>
        <p class="muted">${decision.actor} · ${decision.acceptedAt}</p>
        <button data-action="undo-acceptance" ?disabled=${readonly}
          @click=${() => reconciliation.revokeException(issue.id)}>Undo acceptance</button>`}
      ${readonly ? html`<p class="muted">Choose an editable scenario to accept exceptions.</p>` : ''}
      ${this.actionError !== '' ? html`<p role="alert">${this.actionError}</p>` : ''}
    </section>`;
  }

  _renderExceptions(query) {
    const entries = this.snapshot.exceptions.filter((entry) => entry.category === this.category
      && [entry.taskTitle, entry.planName, entry.findingTitle, entry.reason, entry.actor]
        .join(' ').toLowerCase().includes(query));
    return html`<div class="exception-list" aria-label="Accepted exceptions">
      ${entries.length === 0 ? html`<p>No matching exception decisions.</p>` : ''}
      ${repeat(entries, (entry) => entry.id, (entry) => {
        const groupId = entry.category === 'schedule' ? `schedule:${entry.identity.taskId}` : entry.id;
        const group = this.snapshot.groups.find((candidate) => candidate.id === groupId);
        return html`<section class="exception-entry">
          <button class="item" aria-pressed=${this.selectedId === groupId && this.selectedIssueId === entry.id}
            @click=${() => {
              this.selectedId = groupId;
              this._selectedIssueType = entry.identity.rule;
              this.selectedIssueId = entry.id;
              this._selectedTask = { id: groupId, category: entry.category, featureId: entry.identity.taskId };
              this._reviewFeatureIds = new Set(entry.identity.path);
              this._locateRevision++;
            }}><strong>${entry.taskTitle}</strong><small>${entry.planName}</small>
            <small>${entry.findingTitle}</small></button>
          <p class="accepted-status">${entry.status === 'revoked' ? `Revoked: ${entry.revocationReason}`
            : 'Accepted exception'} · ${entry.saveStatus === 'pending'
              ? entry.status === 'revoked' ? 'Revocation not saved' : 'Acceptance not saved'
              : 'Saved in this scenario'}</p>
          <p>${entry.reason}</p><p class="muted">${entry.actor} · ${entry.acceptedAt}</p>
          ${entry.status === 'revoked' ? html`<p class="muted">${entry.revokedAt}</p>` : ''}
          ${entry.status === 'active' && (group === undefined || !group.issues.some((issue) => issue.id === entry.id))
            ? html`<button data-action="undo-acceptance"
              ?disabled=${sel.scenario.getActiveScenario().readonly === true}
              @click=${() => reconciliation.revokeException(entry.id)}>Undo acceptance</button>` : ''}
          ${this.selectedId === groupId && this.selectedIssueId === entry.id && group !== undefined
            ? this._renderTaskDetails(group, entry.identity.rule, entry.id) : ''}
        </section>`;
      })}
    </div>`;
  }

  render() {
    const snapshot = this.snapshot;
    const query = this.query.trim().toLowerCase();
    const groups = snapshot.groups.filter((group) =>
      (this.category === 'all' || group.category === this.category)
      && [taskLabel(snapshot, group.featureId), projectLabel(snapshot, group.featureId),
        ...group.issues.flatMap((issue) => [issue.title, issue.description])]
        .join(' ').toLowerCase().includes(query));
    const selected = groups.find((group) => group.id === this.selectedId);
    let current = selected;
    if (selected === undefined && this._selectedTask !== null
      && this._selectedTask.id === this.selectedId
      && (this.category === 'all' || this._selectedTask.category === this.category)
      && snapshot.status === 'ready' && snapshot.featuresById.has(this._selectedTask.featureId)
      && !snapshot.groups.some((group) => group.id === this.selectedId)) {
      current = { ...this._selectedTask, issues: [] };
    }
    const issueClasses = new Map();
    for (const group of groups) {
      for (const issue of group.issues) {
        if (!issueClasses.has(issue.type)) {
          issueClasses.set(issue.type, { type: issue.type, title: issue.title, tasks: new Map() });
        }
        issueClasses.get(issue.type).tasks.set(group.id, group);
      }
    }
    return html`<button class="edge"
      aria-label=${this.toolboxHidden ? 'Show reconciliation toolbox' : 'Hide reconciliation toolbox'}
      title=${this.toolboxHidden ? 'Show reconciliation toolbox' : 'Hide reconciliation toolbox'}
      aria-expanded=${!this.toolboxHidden} aria-controls="toolbox"
      @click=${() => this._onToggleToolbox()}>${this.toolboxHidden ? '\u203a' : '\u2039'}</button>
    <section class="toolbox" id="toolbox" role="region" aria-labelledby="review-heading"
      ?hidden=${this.toolboxHidden} ?inert=${this.toolboxHidden} @keydown=${(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); this.close(); }
      }}>
      <div class="filters expansion-section">
        <header><h2 class="section-title" id="review-heading"><span class="section-icon" aria-hidden="true">${'\u2699'}</span>Reconciliation</h2>
          <span class="scenario-name">${snapshot.scenarioName}</span></header>
        <div role="group" aria-labelledby="marker-label">
          <div class="group-label" id="marker-label">Board warning markers</div>
          <button class="marker-toggle" data-action="toggle-markers"
            aria-pressed=${snapshot.markersVisible}
            @click=${() => reconciliation.setMarkersVisible(!snapshot.markersVisible)}>Show on task cards</button>
        </div>
        <div>
          <div class="group-label" id="issue-category-label">Issue category</div>
          <div class="categories segmented-group context-group" role="group" aria-labelledby="issue-category-label">
          ${categoryCounts(snapshot).map((category) => html`<button class="category segment-btn ${this.category === category.id ? 'active' : ''}"
            data-category=${category.id} aria-pressed=${this.category === category.id}
            @click=${() => { this.category = category.id; this.selectedId = null; this._selectedIssueType = null; this.selectedIssueId = null; }}>
            ${category.label}<strong class="count">${category.count}</strong>
          </button>`)}
          </div>
        </div>
        <div class="segmented-group context-group" role="group" aria-label="Review view">
          <button class="segment-btn ${this.reviewView === 'findings' ? 'active' : ''}"
            data-review-view="findings" aria-pressed=${this.reviewView === 'findings'}
            @click=${() => { this.reviewView = 'findings'; }}>Findings</button>
          <button class="segment-btn ${this.reviewView === 'accepted' ? 'active' : ''}"
            data-review-view="accepted" aria-pressed=${this.reviewView === 'accepted'}
            @click=${() => { this.reviewView = 'accepted'; }}>Accepted exceptions</button>
        </div>
        ${this.category === 'schedule' || (current !== undefined && current.category === 'schedule') ? html`
          <div>
            <div class="group-label" id="board-context-label">Board context</div>
            <div class="context-controls segmented-group context-group" role="group" aria-labelledby="board-context-label">
              <button class="segment-btn ${this.contextMode === 'relevant' ? 'active' : ''}"
                data-context="relevant" aria-pressed=${this.contextMode === 'relevant'}
                @click=${() => { this.contextMode = 'relevant'; }}>Relevant context</button>
              <button class="segment-btn ${this.contextMode === 'all' ? 'active' : ''}"
                data-context="all" aria-pressed=${this.contextMode === 'all'}
                @click=${() => { this.contextMode = 'all'; }}>All tasks</button>
            </div>
          </div>` : ''}
        <input type="search" aria-label="Search issues" placeholder="Search tasks or projects" .value=${this.query}
          @input=${(event) => { this.query = event.target.value; this.selectedId = null; this._selectedIssueType = null; this.selectedIssueId = null; }}>
      </div>
      <div class="workspace">
        <section class="list expansion-section" aria-label="Issue classes">
          <h3 class="section-title"><span class="section-icon" aria-hidden="true">${'\u2637'}</span>Issues &amp; actions</h3>
          <p role="status">${statusText(snapshot)}</p>
          ${this.presentationError !== '' ? html`<p role="alert">${this.presentationError}</p>` : ''}
          ${groups.length === 0 && snapshot.status === 'ready' && snapshot.groups.length > 0
            ? html`<p>No matching issues.</p>` : ''}
          ${this.reviewView === 'accepted' ? this._renderExceptions(query)
            : repeat([...issueClasses.values()], (issueClass) => issueClass.type, (issueClass) => html`
            <details class="issue-class" data-issue-type=${issueClass.type}
              .open=${current !== undefined && issueClass.tasks.has(current.id)
                && (this._selectedIssueType === issueClass.type
                  || (this._selectedIssueType === null && current.issues[0].type === issueClass.type))}>
              <summary><span>${issueClass.title}</span><strong class="count">${issueClass.tasks.size}</strong></summary>
              ${repeat([...issueClass.tasks.values()], (group) => group.id, (group) => {
                const isSelected = current === group
                  && (this._selectedIssueType === issueClass.type
                    || (this._selectedIssueType === null && issueClass.type === group.issues[0].type));
                  const findingCount = group.issues.filter((issue) => issue.type === issueClass.type).length;
                return html`<div class="task"><button class="item" data-task-id=${group.id}
                  aria-pressed=${isSelected} aria-expanded=${isSelected}
                  @click=${() => this._onSelectTask(group, issueClass.type)}>
                  <strong>${taskLabel(snapshot, group.featureId)}</strong>
                  <small>${projectLabel(snapshot, group.featureId)}</small>
                  ${findingCount > 1 ? html`<small class="finding-count">${findingCount} findings in this class</small>` : ''}
                  <small>${changeLabel(group.change)}</small>
                </button>${isSelected ? this._renderTaskDetails(group, issueClass.type) : ''}</div>`;
              })}
            </details>`)}
          ${this.reviewView === 'findings' && current !== undefined && (current.issues.length === 0
            || (this._selectedIssueType !== null
              && !current.issues.some((issue) => issue.type === this._selectedIssueType))) ? html`
            <section class="resolved-task"><h3>${taskLabel(snapshot, current.featureId)}</h3>
              ${this._renderTaskDetails(current)}</section>` : ''}
        </section>
      </div>
    </section>`;
  }
}

customElements.define('reconciliation-review', ReconciliationReview);