import { assessReconciliation } from './assessment.js';
import { bus } from '../../core/EventBus.js';
import { ScenarioEvents } from '../../core/EventRegistry.js';
import { EXCEPTIONS_KEY, canonicalEvidence, exceptionIdentity, exceptionEvidence,
  exceptionDecisions } from './exceptions.js';

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function emptySnapshot(status) {
  return { status, markersVisible: true, scenarioName: '', exceptions: [], issues: [], groups: [], visibleIds: new Set(),
    featuresById: new Map(), sourceById: new Map(), projectsById: new Map() };
}

const PRIORITY = { error: 0, high: 1, warning: 2, info: 3 };

export class ReconciliationController {
  constructor({ store, selectors, commands, clock = () => new Date() }) {
    this.store = store;
    this.selectors = selectors;
    this.commands = commands;
    this.clock = clock;
    this.snapshot = emptySnapshot('inactive');
    this._markersVisible = true;
    this._listeners = new Set();
    this._unsubscribe = null;
    this._timer = null;
    this._key = [];
    this._featureIssues = new Map();
    this._reviewFeatureId = null;
    this._savedDecisions = new Map();
  }

  _editableScenario() {
    const state = this.store.getState();
    const scenario = state.scenarios.items.find((item) => item.id === state.scenarios.activeId);
    if (scenario === undefined || scenario.id === 'baseline' || scenario.readonly === true) {
      throw new Error('Accepting exceptions requires an editable scenario');
    }
    return scenario;
  }

  acceptException(issueId, { actor, reason }) {
    const scenario = this._editableScenario();
    this.refresh();
    const issue = this.snapshot.issues.find((finding) => finding.id === issueId);
    if (issue === undefined || issue.severity === 'info') {
      throw new Error('Only a current, assessed finding can be accepted');
    }
    if (actor.trim() === '' || reason.trim() === '') {
      throw new Error('An exception requires an actor and reason');
    }
    const identity = exceptionIdentity(issue);
    const state = this.store.getState();
    const task = this.snapshot.featuresById.get(issue.featureId);
    const project = this.snapshot.projectsById.get(String(task.project));
    const record = { id: issueId, identity, actor, reason: reason.trim(), category: issue.category,
      findingTitle: issue.title, taskTitle: task.title, planId: String(task.project),
      planName: project === undefined ? String(task.project) : project.name,
      acceptedAt: this.clock().toISOString(), status: 'active',
      evidence: exceptionEvidence(identity, this.snapshot.sourceById,
        scenario, state.baseline.projects, this.selectors.feature.getTaskTypeHierarchy()) };
    this.commands.pluginScenarioData.set(scenario.id, EXCEPTIONS_KEY, { version: 1,
      decisions: [...exceptionDecisions(scenario).filter((decision) => decision.id !== issueId), record] });
  }

  revokeException(issueId) {
    const scenario = this._editableScenario();
    this.commands.pluginScenarioData.set(scenario.id, EXCEPTIONS_KEY, { version: 1,
      decisions: exceptionDecisions(scenario).map((decision) => decision.id === issueId
        ? { ...decision, status: 'revoked', revokedAt: this.clock().toISOString(),
          revocationReason: 'Acceptance undone' } : decision) });
  }

  decisionSummary(scenario) {
    const decisions = exceptionDecisions(scenario);
    const changed = this.store.getState().scenarios.changedIds.includes(scenario.id);
    const saved = this._savedDecisions.get(scenario.id);
    return decisions.map((decision) => ({ ...decision,
      saveStatus: !changed || (saved !== undefined && saved.has(canonicalEvidence(decision)))
        ? 'saved' : 'pending' }));
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  start() {
    if (this._unsubscribe) return;
    this._unsubscribe = this.store.subscribe(() => this.refresh());
    this._unsubscribeSaved = bus.on(ScenarioEvents.SAVED, ({ scenarioId, scenario }) => {
      this._savedDecisions.set(scenarioId, new Set(exceptionDecisions(scenario).map(canonicalEvidence)));
      this._key = [];
      this.refresh();
    });
    this._timer = setInterval(() => this.refresh(), 60000);
    this.refresh();
  }

  stop() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribeSaved();
    }
    clearInterval(this._timer);
    this._unsubscribe = null;
    this._timer = null;
    this._key = [];
    this._featureIssues.clear();
    this._reviewFeatureId = null;
    this._publish(emptySnapshot('inactive'));
  }

  _publish(snapshot) {
    this.snapshot = { ...snapshot, markersVisible: this._markersVisible };
    for (const listener of this._listeners) listener(this.snapshot);
  }

  setMarkersVisible(visible) {
    this._markersVisible = visible;
    this._publish(this.snapshot);
  }

  setReviewFeatureId(featureId) {
    if (this._reviewFeatureId === featureId) return;
    const previous = this._reviewFeatureId;
    this._reviewFeatureId = featureId;
    if (previous !== null && !this.selectors.scope.getVisibleFeatures()
      .some((feature) => String(feature.id) === previous)) {
      this._key = [];
      this.refresh();
    } else if (this._key.length > 0) {
      this._key[this._key.length - 1] = featureId;
    }
  }

  issuesForFeature(featureId) {
    const issues = this._featureIssues.get(String(featureId));
    return issues === undefined ? [] : issues;
  }

  refresh() {
    const state = this.store.getState();
    if (state.lifecycle.status !== 'ready') {
      const status = state.lifecycle.status === 'bootstrapping' ? 'loading' : 'unavailable';
      this._key = [];
      this._featureIssues.clear();
      if (this.snapshot.status !== status) this._publish(emptySnapshot(status));
      return;
    }
    const features = this.selectors.scope.getResolvedFeatures();
    const visible = this.selectors.scope.getVisibleFeatures();
    const today = localDate(this.clock());
    const key = [features, visible, state.baseline.features, state.baseline.projects,
      state.scenarios.activeId, state.scenarios.items, state.scenarios.changedIds, today, this._reviewFeatureId];
    if (key.every((value, index) => value === this._key[index])) return;
    const visibleIds = new Set(visible.map((feature) => String(feature.id)));
    if (this._reviewFeatureId !== null
      && features.some((feature) => String(feature.id) === this._reviewFeatureId)) {
      visibleIds.add(this._reviewFeatureId);
    }
    const scenario = state.scenarios.items.find((item) => item.id === state.scenarios.activeId);
    if (!scenario) throw new Error('Reconciliation requires an active scenario');
    const featuresById = new Map(features.map((feature) => [String(feature.id), feature]));
    const sourceById = new Map(state.baseline.features.map((feature) => [String(feature.id), feature]));
    const hierarchy = this.selectors.feature.getTaskTypeHierarchy();
    for (const item of state.scenarios.items) {
      if (item.id === 'baseline') continue;
      const stored = exceptionDecisions(item);
      if (!state.scenarios.changedIds.includes(item.id)) {
        this._savedDecisions.set(item.id, new Set(stored.map(canonicalEvidence)));
      }
      const checked = stored.map((decision) => decision.status === 'active'
        && decision.evidence !== exceptionEvidence(decision.identity, sourceById,
          item, state.baseline.projects, hierarchy)
        ? { ...decision, status: 'revoked', revokedAt: this.clock().toISOString(),
          revocationReason: 'Task, relationship or assessment configuration changed' } : decision);
      if (item.readonly !== true && checked.some((decision, index) => decision !== stored[index])) {
        this.commands.pluginScenarioData.set(item.id, EXCEPTIONS_KEY, { version: 1, decisions: checked });
        return;
      }
    }
    const decisions = scenario.id === 'baseline' ? [] : exceptionDecisions(scenario);
    const validated = decisions.map((decision) => decision.status === 'active'
      && decision.evidence !== exceptionEvidence(decision.identity, sourceById,
        scenario, state.baseline.projects, hierarchy)
      ? { ...decision, status: 'revoked', revokedAt: this.clock().toISOString(),
        revocationReason: 'Task, relationship or assessment configuration changed' } : decision);
    const saved = this._savedDecisions.get(scenario.id);
    const exceptions = validated.map((decision) => ({ ...decision,
      saveStatus: saved !== undefined && saved.has(canonicalEvidence(decision)) ? 'saved' : 'pending' }));
    const issues = assessReconciliation({ features, sourceFeatures: state.baseline.features,
      scopeIds: visibleIds, today, projects: state.baseline.projects,
      hierarchy }).map((issue) => {
        const decision = exceptions.find((entry) => entry.id === issue.id && entry.status === 'active'
          && canonicalEvidence(entry.identity) === canonicalEvidence(exceptionIdentity(issue)));
        return { ...issue, acceptance: decision === undefined ? null
          : { ...decision, status: decision.saveStatus } };
      });
    const grouped = new Map();
    this._featureIssues.clear();
    for (const issue of issues) {
      const groupId = issue.category === 'schedule' ? `schedule:${issue.featureId}` : issue.id;
      if (!grouped.has(groupId)) grouped.set(groupId, { ...issue, id: groupId, issues: [] });
      const group = grouped.get(groupId);
      group.issues.push(issue);
      if (PRIORITY[issue.severity] < PRIORITY[group.severity]) group.severity = issue.severity;
      if (issue.change === 'new' || (issue.change === 'worsened' && group.change !== 'new')) {
        group.change = issue.change;
      }
      for (const featureId of new Set([...issue.path, issue.featureId, issue.relatedId])) {
        if (featureId === null) continue;
        if (!this._featureIssues.has(featureId)) this._featureIssues.set(featureId, []);
        this._featureIssues.get(featureId).push(issue);
      }
    }
    this._key = key;
    this._publish({ status: 'ready', scenarioName: scenario.name, exceptions, issues,
      groups: [...grouped.values()].sort((first, second) =>
        PRIORITY[first.severity] - PRIORITY[second.severity] || first.id.localeCompare(second.id)),
      visibleIds, featuresById, sourceById,
      projectsById: new Map(state.baseline.projects.map((project) => [String(project.id), project])) });
    if (validated.some((decision, index) => decision !== decisions[index])
      && scenario.readonly !== true) {
      this.commands.pluginScenarioData.set(scenario.id, EXCEPTIONS_KEY, { version: 1, decisions: validated });
    }
  }
}