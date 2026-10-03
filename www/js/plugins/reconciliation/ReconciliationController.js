import { assessReconciliation } from './assessment.js';

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function emptySnapshot(status) {
  return { status, scenarioName: '', issues: [], groups: [], visibleIds: new Set(),
    featuresById: new Map(), sourceById: new Map(), projectsById: new Map() };
}

const PRIORITY = { error: 0, high: 1, warning: 2, info: 3 };

export class ReconciliationController {
  constructor({ store, selectors, clock = () => new Date() }) {
    this.store = store;
    this.selectors = selectors;
    this.clock = clock;
    this.snapshot = emptySnapshot('inactive');
    this._listeners = new Set();
    this._unsubscribe = null;
    this._timer = null;
    this._key = [];
    this._featureIssues = new Map();
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  start() {
    if (this._unsubscribe) return;
    this._unsubscribe = this.store.subscribe(() => this.refresh());
    this._timer = setInterval(() => this.refresh(), 60000);
    this.refresh();
  }

  stop() {
    if (this._unsubscribe) this._unsubscribe();
    clearInterval(this._timer);
    this._unsubscribe = null;
    this._timer = null;
    this._key = [];
    this._featureIssues.clear();
    this._publish(emptySnapshot('inactive'));
  }

  _publish(snapshot) {
    this.snapshot = snapshot;
    for (const listener of this._listeners) listener(snapshot);
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
      state.scenarios.activeId, state.scenarios.items, today];
    if (key.every((value, index) => value === this._key[index])) return;
    const visibleIds = new Set(visible.map((feature) => String(feature.id)));
    const issues = assessReconciliation({ features, sourceFeatures: state.baseline.features,
      scopeIds: visibleIds, today, projects: state.baseline.projects,
      hierarchy: this.selectors.feature.getTaskTypeHierarchy() });
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
    const scenario = state.scenarios.items.find((item) => item.id === state.scenarios.activeId);
    if (!scenario) throw new Error('Reconciliation requires an active scenario');
    this._key = key;
    this._publish({ status: 'ready', scenarioName: scenario.name, issues,
      groups: [...grouped.values()].sort((first, second) =>
        PRIORITY[first.severity] - PRIORITY[second.severity] || first.id.localeCompare(second.id)),
      visibleIds, featuresById: new Map(features.map((feature) => [String(feature.id), feature])),
      sourceById: new Map(state.baseline.features.map((feature) => [String(feature.id), feature])),
      projectsById: new Map(state.baseline.projects.map((project) => [String(project.id), project])) });
  }
}