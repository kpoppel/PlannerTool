import { displayFixture } from '../helpers/workItemDisplay.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PluginRegistry from '../../www/js/core/pluginRegistry.js';
import modulesConfig from '../../www/js/modules.config.json';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { cmd } from '../../www/js/application/imports.js';
import { dataService } from '../../www/js/services/dataService.js';
import { reconciliation } from '../../www/js/plugins/reconciliation/runtime.js';
import * as boardUtils from '../../www/js/components/board-utils.js';
import * as publication from '../../www/js/components/scenarioPublication.js';
import { openReconciliationReview } from '../../www/js/plugins/reconciliation/ReconciliationReview.lit.js';
import '../../www/js/plugins/reconciliation/ReconciliationTaskMarker.lit.js';
import * as presentation from '../../www/js/plugins/reconciliation/presentation.js';

const config = modulesConfig.modules.find((entry) => entry.id === 'plugin-reconciliation');
const schemaFiles = import.meta.glob('../../www/js/plugins/*.schema.json', {
  query: '?raw', import: 'default', eager: true,
});

describe('Reconciliation detection menu', () => {
  it('exports presentation helpers used by the review with constraint and plan context', () => {
    const snapshot = {
      groups: [{ category: 'quality', featureId: 'task' },
        { category: 'schedule', featureId: 'task' }, { category: 'schedule', featureId: 'related' }],
      featuresById: new Map([
        ['task', { title: 'Delivery', project: 'one' }],
        ['related', { title: 'Prerequisite', project: 'two' }],
      ]),
      projectsById: new Map([
        ['one', { name: 'Delivery plan' }], ['two', { name: 'Other plan' }],
      ]),
    };
    expect(presentation.categoryCounts(snapshot).map(({ id, count }) => ({ id, count })))
      .toEqual([{ id: 'schedule', count: 2 }, { id: 'quality', count: 1 }]);
    expect(presentation.categoryCounts({ groups: [] }).map(({ id }) => id))
      .toEqual(['quality', 'schedule']);
    const explanation = presentation.findingExplanation(snapshot, {
      type: 'dependency-order', category: 'schedule', severity: 'warning',
      featureId: 'task', relatedId: 'related', path: ['task', 'related'],
    });
    expect(explanation.constraint).toContain('predecessor starts');
    expect(explanation.affectedPlans).toEqual(['Delivery plan', 'Other plan']);
    expect(explanation.impact).toContain('related');
  });

  const plugins = [];
  it('exports presentation helpers that distinguish separate plans with identical names', () => {
    const snapshot = {
      featuresById: new Map([
        ['task', { project: 'one' }], ['related', { project: 'two' }],
      ]),
      projectsById: new Map([
        ['one', { name: 'Delivery' }], ['two', { name: 'Delivery' }],
      ]),
    };
    const explanation = presentation.findingExplanation(snapshot, {
      type: 'containment', category: 'schedule', severity: 'warning',
      featureId: 'task', relatedId: 'related', path: ['task', 'related'],
    });
    expect(explanation.affectedPlans).toHaveLength(2);
    expect(explanation.impact).toContain('Cross-plan impact');
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T12:00:00'));
    store.setState(createInitialAppState(), true);
    vi.spyOn(boardUtils, 'findInBoard').mockReturnValue({ centerFeatureById: vi.fn(),
      setReconciliationContext: vi.fn(async () => {}), updateComplete: Promise.resolve(true) });
    HTMLDialogElement.prototype.showModal = vi.fn(function () { this.setAttribute('open', ''); });
    HTMLDialogElement.prototype.close = vi.fn(function () { this.removeAttribute('open'); });
  });
  afterEach(() => {
    for (const plugin of plugins.splice(0)) plugin.destroy();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function openMenu() {
    const plugin = new PluginRegistry[config.id](config.id, config);
    plugins.push(plugin);
    await plugin.init();
    plugin.toggleMenu();
    const element = document.querySelector('reconciliation-review');
    await element.updateComplete;
    return { plugin, element };
  }

  function seedActions({ readonly = false, future = false, linked = false } = {}) {
    const state = createInitialAppState();
    const task = { process_id: 'process', id: 'task', title: 'Delivery', type: 'Feature', project: 'project',
      state: 'Working', start: future ? '2026-10-10' : '2026-10-01',
      end: future ? '2026-10-20' : '2026-10-02', capacity: [], relations: [], parentId: null };
    const project = { id: 'project', name: 'Delivery plan', type: 'project',
      work_item_display: displayFixture([['Feature']], { Working: 'InProgress', Delivered: 'Completed', Cancelled: 'Completed',
        Draft: 'Proposed', Ready: 'Proposed' }),
       };
    state.lifecycle.status = 'ready';
    state.baseline.projects = [project, { ...project, id: 'other', name: 'Other plan' }];
    state.baseline.features = linked ? [task, { ...task, id: 'predecessor', title: 'Prerequisite',
      project: 'other', start: '2026-10-02', end: '2026-10-20',
      relations: [{ type: 'Successor', id: 'task' }, { type: 'Related', id: 'task' }] }] : [task];
    state.selection.projectIds = ['project', 'other'];
    state.selection.featureStateNames = project.work_item_display[0].tiers[0][0].states.map((state) => state.name);
    if (!readonly) {
      state.scenarios.activeId = 'review';
      state.scenarios.items.push({ ...state.scenarios.items[0], id: 'review', name: 'Review',
        readonly: false, overrides: {} });
    }
    store.setState(state, true);
    return state;
  }

  it('registers an enabled nonexclusive menu, not a startup tool', () => {
    expect(config.type).toBe('menu');
    expect(config.enabled).toBe(true);
    expect(config.activateOnStartup).toBe(false);
    expect(config.exclusive).toBe(false);
    expect(config.menuPosition).toBe('before-tools');
  });

  it('opens publication from the toolbox without losing selected issue context', async () => {
    const { element } = await openMenu();
    seedActions();
    await element.updateComplete;
    const group = reconciliation.snapshot.groups[0];
    element._onSelectTask(group, group.issues[0].type);
    await element.updateComplete;
    const selectedId = element.selectedId;
    const issueId = element.selectedIssueId;
    const publish = vi.spyOn(publication, 'publishScenario').mockResolvedValue({ ok: true,
      data: { cancelled: true } });
    element.shadowRoot.querySelector('[data-action="publish-scenario"]').click();
    await element.updateComplete;
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ id: 'review' }));
    expect(element.selectedId).toBe(selectedId);
    expect(element.selectedIssueId).toBe(issueId);
    expect(element.isConnected).toBe(true);
  });

  it('stages individual exceptions without task edits or suppressing baseline findings', async () => {
    const { element } = await openMenu();
    seedActions({ linked: true });
    await element.updateComplete;
    const issue = reconciliation.snapshot.issues.find((finding) => finding.type === 'past-unfinished');
    const originalCount = reconciliation.snapshot.issues.length;
    reconciliation.acceptException(issue.id, { actor: 'editor@example.test', reason: 'Agreed delay' });
    await element.updateComplete;
    const scenario = store.getState().scenarios.items.find((item) => item.id === 'review');
    expect(scenario.overrides).toEqual({});
    expect(store.getState().scenarios.changedIds).toContain('review');
    expect(reconciliation.snapshot.issues).toHaveLength(originalCount);
    expect(reconciliation.snapshot.issues.find((finding) => finding.id === issue.id).acceptance.status)
      .toBe('pending');
    expect(reconciliation.snapshot.issues.find((finding) => finding.type === 'dependency-order').acceptance)
      .toBeNull();
    cmd.scenario.activateScenario('baseline');
    expect(reconciliation.snapshot.issues.find((finding) => finding.id === issue.id).acceptance).toBeNull();
    expect(() => reconciliation.acceptException(issue.id, { actor: 'editor@example.test', reason: 'Delay' }))
      .toThrow('editable scenario');
    cmd.scenario.activateScenario('review');
    expect(reconciliation.snapshot.issues.find((finding) => finding.id === issue.id).acceptance.status)
      .toBe('pending');
    reconciliation.revokeException(issue.id);
    expect(reconciliation.snapshot.issues.find((finding) => finding.id === issue.id).acceptance).toBeNull();
  });

  it('revokes acceptance on scenario edits and does not resurrect it on task revert', async () => {
    await openMenu();
    seedActions({ linked: true });
    const issue = reconciliation.snapshot.issues.find((finding) => finding.type === 'dependency-order');
    reconciliation.acceptException(issue.id, { actor: 'editor@example.test', reason: 'Approved overlap' });
    cmd.feature.updateFeatureField('predecessor', 'title', 'Updated prerequisite');
    expect(reconciliation.snapshot.issues.find((finding) => finding.id === issue.id).acceptance).toBeNull();
    cmd.feature.revertFeature('predecessor');
    expect(reconciliation.snapshot.issues.find((finding) => finding.id === issue.id).acceptance).toBeNull();
  });

  it('keeps failed saves pending and distinguishes saved acceptance from subsequent task changes', async () => {
    await openMenu();
    seedActions();
    const issue = reconciliation.snapshot.issues[0];
    reconciliation.acceptException(issue.id, { actor: 'editor@example.test', reason: 'Agreed delay' });
    const save = vi.spyOn(dataService, 'saveScenario').mockResolvedValueOnce({ ok: false,
      error: { message: 'Offline' } }).mockResolvedValue({ ok: true, data: {} });
    expect((await cmd.scenario.saveScenario('review')).ok).toBe(false);
    expect(reconciliation.snapshot.issues[0].acceptance.status).toBe('pending');
    expect(store.getState().scenarios.changedIds).toContain('review');
    await cmd.scenario.saveScenario('review');
    expect(save.mock.calls[1][0].pluginData['plugin-reconciliation'].decisions[0].reason)
      .toBe('Agreed delay');
    expect(reconciliation.snapshot.issues[0].acceptance.status).toBe('saved');
    store.setState((state) => ({ ...state, selection: { ...state.selection, projectIds: ['project'] } }));
    expect(reconciliation.snapshot.issues[0].acceptance.status).toBe('saved');
    cmd.scenario.activateScenario('baseline');
    expect(reconciliation.snapshot.issues[0].acceptance).toBeNull();
  });

  it('revokes dormant scenario decisions when observed source data changes, even while viewing baseline', async () => {
    await openMenu();
    seedActions({ linked: true });
    const issue = reconciliation.snapshot.issues.find((finding) => finding.type === 'dependency-order');
    reconciliation.acceptException(issue.id, { actor: 'editor@example.test', reason: 'Agreed overlap' });
    cmd.scenario.activateScenario('baseline');
    const source = store.getState().baseline.features;
    store.setState((state) => ({ ...state, baseline: { ...state.baseline,
      features: source.map((task) => task.id === 'predecessor' ? { ...task, title: 'ADO changed title' } : task) } }));
    store.setState((state) => ({ ...state, baseline: { ...state.baseline, features: source } }));
    cmd.scenario.activateScenario('review');
    expect(reconciliation.snapshot.issues.find((finding) => finding.id === issue.id).acceptance).toBeNull();
    expect(reconciliation.snapshot.exceptions[0].status).toBe('revoked');
  });

  it('shows reasoned acceptance, a distinct marker and an accepted view without losing selection on undo', async () => {
    const { element } = await openMenu();
    seedActions({ linked: true });
    vi.spyOn(dataService, 'getLocalPref').mockResolvedValue('editor@example.test');
    await element.updateComplete;
    element.shadowRoot.querySelector('[data-task-id="past-unfinished:task"]').click();
    await element.updateComplete;
    const accept = element.shadowRoot.querySelector('[data-action="accept-exception"]');
    expect(accept.disabled).toBe(true);
    const reason = element.shadowRoot.querySelector('[data-exception-reason]');
    reason.value = 'Agreed delay';
    reason.dispatchEvent(new Event('input'));
    await element.updateComplete;
    element.shadowRoot.querySelector('[data-action="accept-exception"]').click();
    await vi.waitFor(() => expect(reconciliation.snapshot.issues
      .find((issue) => issue.type === 'past-unfinished').acceptance).not.toBeNull());
    await element.updateComplete;
    expect(element.shadowRoot.textContent).toContain('Acceptance not saved');
    const marker = document.createElement('reconciliation-task-marker');
    marker.featureId = 'task';
    document.body.appendChild(marker);
    await marker.updateComplete;
    expect(marker.shadowRoot.querySelector('[data-marker="exception"]').getAttribute('aria-label'))
      .toContain('Accepted exception');
    expect(marker.shadowRoot.querySelector('[data-marker="warning"]')).not.toBeNull();
    element.shadowRoot.querySelector('[data-review-view="accepted"]').click();
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('.exception-list').textContent).toContain('Agreed delay');
    element.shadowRoot.querySelector('[data-action="undo-acceptance"]').click();
    await element.updateComplete;
    await marker.updateComplete;
    expect(element.selectedId).toBe('past-unfinished:task');
    expect(marker.shadowRoot.querySelector('[data-marker="exception"]')).toBeNull();
    expect(element.shadowRoot.textContent).toContain('Acceptance undone');
  });

  it('keeps decisions made during an in-flight save pending', async () => {
    await openMenu();
    seedActions({ linked: true });
    const first = reconciliation.snapshot.issues.find((issue) => issue.type === 'past-unfinished');
    const second = reconciliation.snapshot.issues.find((issue) => issue.type === 'dependency-order');
    reconciliation.acceptException(first.id, { actor: 'editor@example.test', reason: 'Agreed delay' });
    let finishSave;
    vi.spyOn(dataService, 'saveScenario').mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    const pending = cmd.scenario.saveScenario('review');
    reconciliation.acceptException(second.id, { actor: 'editor@example.test', reason: 'Agreed overlap' });
    finishSave({ ok: true, data: {} });
    await pending;
    expect(store.getState().scenarios.changedIds).toContain('review');
    expect(reconciliation.snapshot.issues.find((issue) => issue.id === first.id).acceptance.status).toBe('saved');
    expect(reconciliation.snapshot.issues.find((issue) => issue.id === second.id).acceptance.status).toBe('pending');
  });

  it('revalidates persisted decisions after deactivation and preserves unrelated scenario edits', async () => {
    const { plugin } = await openMenu();
    seedActions();
    const issue = reconciliation.snapshot.issues[0];
    reconciliation.acceptException(issue.id, { actor: 'editor@example.test', reason: 'Agreed delay' });
    vi.spyOn(dataService, 'saveScenario').mockResolvedValue({ ok: true, data: {} });
    await cmd.scenario.saveScenario('review');
    cmd.pluginScenarioData.set('review', 'unrelated-plugin', { note: 'Keep this edit' });
    expect(reconciliation.snapshot.issues[0].acceptance.status).toBe('saved');
    await plugin.destroy();
    store.setState((state) => ({ ...state, baseline: { ...state.baseline,
      features: state.baseline.features.map((task) => ({ ...task, title: 'Changed in ADO' })) } }));
    await plugin.init();
    expect(reconciliation.snapshot.issues[0].acceptance).toBeNull();
    expect(reconciliation.snapshot.exceptions[0].status).toBe('revoked');
    expect(store.getState().scenarios.items.find((scenario) => scenario.id === 'review')
      .pluginData['unrelated-plugin']).toEqual({ note: 'Keep this edit' });
  });

  it('requires actor and reason and refuses incomplete assessments and stale finding IDs', async () => {
    await openMenu();
    const state = seedActions();
    const issue = reconciliation.snapshot.issues[0];
    expect(() => reconciliation.acceptException(issue.id, { actor: '', reason: 'Agreed' })).toThrow('actor and reason');
    expect(() => reconciliation.acceptException(issue.id, { actor: 'editor@example.test', reason: '  ' }))
      .toThrow('actor and reason');
    expect(() => reconciliation.acceptException('missing', { actor: 'editor@example.test', reason: 'Agreed' }))
      .toThrow('current, assessed finding');
    store.setState({ ...state, baseline: { ...state.baseline,
      features: [{ ...state.baseline.features[0], parentId: 'not-loaded' }] } }, true);
    const incomplete = reconciliation.snapshot.issues.find((finding) => finding.type === 'unavailable-parent');
    expect(() => reconciliation.acceptException(incomplete.id, { actor: 'editor@example.test', reason: 'Agreed' }))
      .toThrow('current, assessed finding');
    expect(store.getState().scenarios.changedIds).toEqual([]);
  });

  it('offers configured completion choices, resolves only matching findings and supports revert', async () => {
    const { element } = await openMenu();
    const state = createInitialAppState();
    const task = { process_id: 'process', id: 'task', title: 'Late delivery', type: 'Feature', project: 'project',
      state: 'Working', start: '2026-10-01', end: '2026-10-02', capacity: [],
      relations: [], parentId: null };
    state.lifecycle.status = 'ready';
    state.baseline.projects = [{ id: 'project', name: 'Delivery plan', type: 'project',
      work_item_display: displayFixture([['Epic'], ['Feature']], { Working: 'InProgress', Delivered: 'Completed', Cancelled: 'Completed',
        Draft: 'Proposed' }),  }];
    state.baseline.features = [{ process_id: 'process', ...task, id: 'root', type: 'Epic', end: '2026-10-10' }, task];
    state.selection.projectIds = ['project'];
    state.selection.featureStateNames = ['Working'];
    state.scenarios.activeId = 'review';
    state.scenarios.items.push({ ...state.scenarios.items[0], id: 'review', name: 'Review',
      readonly: false, overrides: {} });
    store.setState(state, true);
    await element.updateComplete;
    element.shadowRoot.querySelector('[data-task-id="past-unfinished:task"]').click();
    await element.updateComplete;
    const choice = element.shadowRoot.querySelector('[data-state-choice]');
    expect([...choice.options].map((option) => option.value)).toEqual(['', 'Delivered', 'Cancelled']);
    expect(element.shadowRoot.querySelector('[data-action="apply-state"]').disabled).toBe(true);
    choice.value = 'Delivered';
    choice.dispatchEvent(new Event('change'));
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('.action-preview').textContent)
      .toContain('Working \u2192 Delivered');
    element.shadowRoot.querySelector('[data-action="apply-state"]').click();
    await element.updateComplete;
    expect(store.getState().scenarios.items.find((scenario) => scenario.id === 'review').overrides.task.state)
      .toBe('Delivered');
    expect(store.getState().baseline.features[1].state).toBe('Working');
    expect(store.getState().scenarios.items[0].overrides).toEqual({});
    expect(store.getState().scenarios.changedIds).toContain('review');
    expect(reconciliation.issuesForFeature('task').map((issue) => issue.type)).toEqual(['missing-parent']);
    expect(element.selectedId).toBe('past-unfinished:task');
    expect(element.shadowRoot.textContent).toContain('Selected finding resolved');
    expect(element.shadowRoot.textContent).toContain('1 other finding remains');
    cmd.feature.revertFeature('task');
    await element.updateComplete;
    expect(reconciliation.issuesForFeature('task').map((issue) => issue.type))
      .toEqual(['past-unfinished', 'missing-parent']);
    expect(element.selectedId).toBe('past-unfinished:task');
  });

  it('omits all field-changing reconciliation controls in read-only scenarios', async () => {
    const { element } = await openMenu();
    seedActions({ future: true, readonly: true });
    await element.updateComplete;
    element.shadowRoot.querySelector('[data-task-id="future-active:task"]').click();
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('[data-state-choice]')).toBeNull();
    expect(element.shadowRoot.querySelectorAll('[data-action="apply-state"], [data-action="edit-dates"], [data-action="accept-exception"], [data-action="save-scenario"], [data-action="publish-scenario"]')).toHaveLength(0);
    expect(element.shadowRoot.textContent).toContain('Read-only scenario');
    expect(() => element._onApplyState(element.snapshot.issues.find((issue) => issue.type === 'future-active')))
      .toThrow('read-only');
    expect(store.getState().scenarios.items[0].overrides).toEqual({});
  });

  it('marks quality findings on the board and opens their owning review category', async () => {
    await openMenu();
    seedActions();
    const marker = document.createElement('reconciliation-task-marker');
    marker.featureId = 'task';
    document.body.appendChild(marker);
    await marker.updateComplete;
    const warning = marker.shadowRoot.querySelector('button');
    expect(warning).not.toBeNull();
    expect(warning.title).toContain('Delivery plan');
    expect(warning.title).not.toContain('Project unavailable');
    warning.click();
    const review = document.querySelector('reconciliation-review');
    await review.updateComplete;
    expect(review.category).toBe('quality');
    expect(review.selectedId).toBe('past-unfinished:task');
  });

  it('reviews cross-plan date impact before opening Scheduling without changing data', async () => {
    const { element } = await openMenu();
    seedActions({ linked: true });
    const panel = document.createElement('details-panel');
    panel.focusSchedulingEditor = vi.fn(async () => {});
    document.body.appendChild(panel);
    await element.updateComplete;
    element.shadowRoot.querySelector('[data-task-id="past-unfinished:task"]').click();
    await element.updateComplete;
    element.shadowRoot.querySelector('[data-action="edit-dates"]').click();
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('.impact-review').textContent).toContain('Other plan');
    expect(element.shadowRoot.querySelector('.impact-review').textContent).toContain('Prerequisite');
    expect(store.getState().featureDisplay.selectedId).toBeNull();
    element.shadowRoot.querySelector('[data-action="continue-edit"]').click();
    await vi.waitFor(() => expect(panel.focusSchedulingEditor).toHaveBeenCalledWith());
    expect(store.getState().featureDisplay.selectedId).toBe('task');
    expect(store.getState().scenarios.items.find((scenario) => scenario.id === 'review').overrides).toEqual({});
    expect(element.selectedId).toBe('past-unfinished:task');
  });

  it('repairs the recorded dependency on its actual owner and preserves unrelated links', async () => {
    const { element } = await openMenu();
    seedActions({ linked: true });
    openReconciliationReview('schedule', 'schedule:task');
    await element.updateComplete;
    element.shadowRoot.querySelector('[data-action="edit-dependency"]').click();
    await element.updateComplete;
    const choice = element.shadowRoot.querySelector('[data-link-choice]');
    expect(choice.options).toHaveLength(2);
    expect(element.shadowRoot.querySelector('.impact-review').textContent).toContain('Other plan');
    expect(element.shadowRoot.querySelector('[data-action="remove-dependency"]').disabled).toBe(true);
    choice.value = '0';
    choice.dispatchEvent(new Event('change'));
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('.link-preview').textContent).toContain('Prerequisite');
    element.shadowRoot.querySelector('[data-action="remove-dependency"]').click();
    await element.updateComplete;
    expect(store.getState().scenarios.items.find((scenario) => scenario.id === 'review').overrides)
      .toEqual({ predecessor: { relations: [{ type: 'Related', id: 'task' }] } });
    expect(store.getState().baseline.features[1].relations).toHaveLength(2);
    expect(reconciliation.snapshot.issues.some((issue) => issue.type === 'dependency-order')).toBe(false);
    expect(reconciliation.snapshot.issues.some((issue) => issue.type === 'past-unfinished')).toBe(true);
    expect(element.selectedId).toBe('schedule:task');
    cmd.feature.revertFeature('predecessor');
    await element.updateComplete;
    expect(reconciliation.snapshot.issues.some((issue) => issue.type === 'dependency-order')).toBe(true);
  });

  it('keeps a resolved issue class selected when a different scheduling finding remains', async () => {
    const { element } = await openMenu();
    const state = seedActions({ linked: true });
    state.baseline.features[0].parentId = 'predecessor';
    store.setState({ ...state, baseline: { ...state.baseline, features: [...state.baseline.features] } }, true);
    openReconciliationReview('schedule', 'schedule:task');
    await element.updateComplete;
    element.shadowRoot.querySelector('.issue-class[data-issue-type="dependency-order"] .item').click();
    await element.updateComplete;
    element.shadowRoot.querySelector('[data-action="edit-dependency"]').click();
    await element.updateComplete;
    const choice = element.shadowRoot.querySelector('[data-link-choice]');
    choice.value = '0';
    choice.dispatchEvent(new Event('change'));
    await element.updateComplete;
    element.shadowRoot.querySelector('[data-action="remove-dependency"]').click();
    await element.updateComplete;
    expect(element.selectedId).toBe('schedule:task');
    expect(element.shadowRoot.querySelector('.resolved-task')).not.toBeNull();
    expect(element.shadowRoot.querySelector('.resolved-task').textContent).toContain('3 other findings remain');
    expect(element.shadowRoot.querySelector('.issue-class[data-issue-type="containment"]')).not.toBeNull();
  });

  it('reviews reciprocal dependency records separately without offering the opposite valid direction', async () => {
    const { element } = await openMenu();
    const state = seedActions({ linked: true });
    state.baseline.features[0].relations = [
      { type: 'Predecessor', id: 'predecessor' }, { type: 'Successor', id: 'predecessor' }];
    state.baseline.features[1].relations.push({ type: 'Predecessor', id: 'task' });
    store.setState({ ...state, baseline: { ...state.baseline, features: [...state.baseline.features] } }, true);
    openReconciliationReview('schedule', 'schedule:task');
    await element.updateComplete;
    element.shadowRoot.querySelector('[data-action="edit-dependency"]').click();
    await element.updateComplete;
    const choice = element.shadowRoot.querySelector('[data-link-choice]');
    expect(choice.options).toHaveLength(3);
    choice.value = '0';
    choice.dispatchEvent(new Event('change'));
    await element.updateComplete;
    element.shadowRoot.querySelector('[data-action="remove-dependency"]').click();
    await element.updateComplete;
    expect(reconciliation.snapshot.issues.some((issue) => issue.type === 'dependency-order')).toBe(true);
    expect(store.getState().scenarios.items.find((scenario) => scenario.id === 'review').overrides.task.relations)
      .toEqual([{ type: 'Successor', id: 'predecessor' }]);
    element.shadowRoot.querySelector('[data-action="edit-dependency"]').click();
    await element.updateComplete;
    const remainingChoice = element.shadowRoot.querySelector('[data-link-choice]');
    expect(remainingChoice.options).toHaveLength(2);
    remainingChoice.value = '0';
    remainingChoice.dispatchEvent(new Event('change'));
    await element.updateComplete;
    element.shadowRoot.querySelector('[data-action="remove-dependency"]').click();
    await element.updateComplete;
    expect(reconciliation.snapshot.issues.some((issue) => issue.type === 'dependency-order')).toBe(false);
  });

  it('discards a configured state draft when scenario or findings change', async () => {
    const { element } = await openMenu();
    seedActions({ future: true });
    await element.updateComplete;
    element.shadowRoot.querySelector('[data-task-id="future-active:task"]').click();
    await element.updateComplete;
    const oldIssue = element.snapshot.issues.find((issue) => issue.type === 'future-active');
    const choice = element.shadowRoot.querySelector('[data-state-choice]');
    choice.value = 'Draft';
    choice.dispatchEvent(new Event('change'));
    await element.updateComplete;
    seedActions();
    await element.updateComplete;
    expect(element._stateChoices.size).toBe(0);
    expect(() => element._onApplyState(oldIssue)).toThrow('current finding');
    expect(store.getState().scenarios.items.find((scenario) => scenario.id === 'review').overrides).toEqual({});
  });

  it('publishes a discoverable JSON configuration schema for the admin page', () => {
    const className = config.id.split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
    const schemaJson = schemaFiles[`../../www/js/plugins/${className}.schema.json`];
    expect(schemaJson).toBeTypeOf('string');
    const schemaData = JSON.parse(schemaJson);
    expect(schemaData).toEqual({
      schema: {
        type: 'object',
        title: 'Reconciliation Configuration',
        properties: {},
        required: [],
      },
      defaultConfig: {},
    });
  });

  it('requires initialization before toggling its toolbox', () => {
    const plugin = new PluginRegistry[config.id](config.id, config);
    expect(() => plugin.toggleMenu()).toThrow('not initialized');
  });

  it('opens without activation and reports loading rather than a fabricated empty queue', async () => {
    const { plugin, element } = await openMenu();
    expect(plugin.initialized).toBe(true);
    expect(plugin.active).toBe(false);
    expect(element.shadowRoot.querySelectorAll('[data-category]')).toHaveLength(2);
    expect(element.shadowRoot.querySelector('[role="status"]').textContent)
      .toContain('Loading');
    expect(element.shadowRoot.querySelector('[data-action="toggle-markers"]').getAttribute('aria-pressed')).toBe('true');
    expect(element.shadowRoot.querySelectorAll('select')).toHaveLength(0);
    await expect(plugin.activate()).rejects.toThrow('not activated');
    await plugin.destroy();
    expect(plugin.initialized).toBe(false);
  });

  it('updates its summary and metadata on edits even while the menu is disconnected', async () => {
    const { plugin, element } = await openMenu();
    element.remove();
    const state = createInitialAppState();
    const parent = { process_id: 'process', id: 'parent', title: 'Programme', type: 'Epic', project: 'project',
      state: 'Working', start: '2026-10-01', end: '2026-10-10', capacity: [], relations: [],
      parentId: null };
    const child = { process_id: 'process', ...parent, id: 'child', title: 'Delivery', type: 'Feature', parentId: 'parent' };
    state.lifecycle.status = 'ready';
    state.baseline.projects = [{ id: 'project', name: 'Programme', type: 'project',
      work_item_display: displayFixture([['Epic'], ['Feature']], { Working: 'InProgress' }),
       }];
    state.baseline.features = [parent, child];
    state.selection.projectIds = ['project'];
    state.selection.featureStateNames = ['Working'];
    state.scenarios.items[0].overrides = { child: { end: '2026-10-22' } };
    store.setState(state, true);
    expect(reconciliation.snapshot.groups).toHaveLength(1);
    expect(plugin.getMetadata().attentionCount).toBe(1);
    document.body.appendChild(element);
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('h2').textContent).toContain('Reconciliation');
    expect(element.shadowRoot.querySelector('h2 .section-icon').getAttribute('aria-hidden')).toBe('true');
    expect(element.shadowRoot.querySelector('.close')).toBeNull();
    expect(element.shadowRoot.querySelectorAll('.issue')).toHaveLength(0);
    expect(element.shadowRoot.querySelector('.review')).toBeNull();
    expect(element.shadowRoot.textContent).toContain(reconciliation.snapshot.scenarioName);
    expect(element.shadowRoot.querySelector('[data-category="schedule"] .count').textContent)
      .toBe('1');
    expect(element.shadowRoot.querySelector('[data-category="quality"] .count').textContent)
      .toBe('0');
    element.shadowRoot.querySelector('[data-category="schedule"]').click();
    const categoryReview = document.querySelector('reconciliation-review');
    await categoryReview.updateComplete;
    expect(categoryReview.category).toBe('schedule');
    expect(categoryReview.shadowRoot.querySelector('[data-category="schedule"]').getAttribute('aria-pressed'))
      .toBe('true');
    categoryReview.shadowRoot.querySelector('.item').click();
    await categoryReview.updateComplete;
    expect(categoryReview.shadowRoot.querySelector('.item[aria-pressed="true"] strong').textContent).toBe('Delivery');
    categoryReview.close();
    const marker = document.createElement('reconciliation-task-marker');
    marker.featureId = 'child';
    document.body.appendChild(marker);
    await marker.updateComplete;
    const warning = marker.shadowRoot.querySelector('button');
    expect(warning.getAttribute('aria-label')).toContain('12 days late');
    expect(warning.title).toContain('New');
    warning.click();
    const review = document.querySelector('reconciliation-review');
    await review.updateComplete;
    expect(review.shadowRoot.textContent).toContain('2026-10-22');
    expect(review.shadowRoot.textContent).toContain('2026-10-10');
    const search = review.shadowRoot.querySelector('input');
    search.value = 'no matching task';
    search.dispatchEvent(new Event('input'));
    await review.updateComplete;
    expect(review.shadowRoot.textContent).toContain('No matching issues');
    search.value = '';
    search.dispatchEvent(new Event('input'));
    await review.updateComplete;
    const centerFeatureById = vi.fn();
    vi.spyOn(boardUtils, 'findInBoard').mockReturnValue({ centerFeatureById,
      setReconciliationContext: vi.fn(async () => {}), updateComplete: Promise.resolve(true) });
    review.selectedId = review.snapshot.groups[0].id;
    await review.updateComplete;
    const selectedId = review.selectedId;
    review._onLocate('child');
    expect(centerFeatureById).toHaveBeenCalledWith('child');
    expect(document.querySelector('reconciliation-review')).toBe(review);
    expect(review.selectedId).toBe(selectedId);
    expect(review.category).toBe('schedule');
    expect(review.query).toBe('');
    review.shadowRoot.querySelector('[data-action="open-task"]').click();
    expect(store.getState().featureDisplay.selectedId).toBe('child');
    expect(document.querySelector('reconciliation-review')).toBe(review);
    expect(store.getState().scenarios.items[0].overrides.child.end).toBe('2026-10-22');
  });

  it('toggles card markers without hiding findings and retains the choice across refreshes', async () => {
    const { plugin, element } = await openMenu();
    const state = createInitialAppState();
    const parent = { process_id: 'process', id: 'parent', title: 'Programme', type: 'Epic', project: 'project',
      state: 'Working', start: '2026-10-01', end: '2026-10-10', capacity: [], relations: [],
      parentId: null };
    const child = { process_id: 'process', ...parent, id: 'child', title: 'Delivery', type: 'Feature', parentId: 'parent' };
    state.lifecycle.status = 'ready';
    state.baseline.projects = [{ id: 'project', name: 'Programme', type: 'project',
      work_item_display: displayFixture([['Epic'], ['Feature']], { Working: 'InProgress' }),
       }];
    state.baseline.features = [parent, child];
    state.selection.projectIds = ['project'];
    state.selection.featureStateNames = ['Working'];
    state.scenarios.items[0].overrides = { child: { end: '2026-10-22' } };
    store.setState(state, true);
    const marker = document.createElement('reconciliation-task-marker');
    marker.featureId = 'child';
    document.body.appendChild(marker);
    await marker.updateComplete;
    await element.updateComplete;
    expect(marker.shadowRoot.querySelector('button')).not.toBeNull();
    const toggle = element.shadowRoot.querySelector('[data-action="toggle-markers"]');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    toggle.click();
    await marker.updateComplete;
    await element.updateComplete;
    expect(marker.shadowRoot.querySelector('button')).toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(plugin.getMetadata().attentionCount).toBe(1);
    expect(element.shadowRoot.querySelector('[data-category="schedule"] .count').textContent).toBe('1');
    state.scenarios.items[0].overrides.child.end = '2026-10-23';
    store.setState({ ...state, baseline: { ...state.baseline, features: [...state.baseline.features] } }, true);
    await marker.updateComplete;
    expect(marker.shadowRoot.querySelector('button')).toBeNull();
    element.remove();
    document.body.appendChild(element);
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('[data-action="toggle-markers"]').getAttribute('aria-pressed')).toBe('false');
    element.shadowRoot.querySelector('[data-action="toggle-markers"]').click();
    await marker.updateComplete;
    expect(marker.shadowRoot.querySelector('button').title).toContain('13 days late');
  });

  it('lists tasks within their issue classes and retains resolved inline selections', async () => {
    await openMenu();
    const state = createInitialAppState();
    const parent = { process_id: 'process', id: 'parent', title: 'Programme', type: 'Epic', project: 'project',
      state: 'Working', start: '2026-10-01', end: '2026-10-10', capacity: [], relations: [],
      parentId: null };
    const conflicted = { process_id: 'process', ...parent, id: 'conflicted', title: 'Conflicted delivery',
      type: 'Feature', parentId: 'parent', start: '2026-09-30', end: '2026-10-22',
      relations: [{ type: 'Predecessor', id: 'parent' }] };
    const first = { process_id: 'process', ...parent, id: 'first', title: 'First delivery', type: 'Feature',
      parentId: 'parent', end: '2026-10-02' };
    const second = { ...first, id: 'second', title: 'Second delivery' };
    state.lifecycle.status = 'ready';
    state.baseline.projects = [{ id: 'project', name: 'Programme', type: 'project',
      work_item_display: displayFixture([['Epic'], ['Feature']], { Working: 'InProgress' }),
       }];
    state.baseline.features = [parent, conflicted, first, second];
    state.selection.projectIds = ['project'];
    state.selection.featureStateNames = ['Working'];
    store.setState(state, true);
    openReconciliationReview('all', 'schedule:conflicted');
    const review = document.querySelector('reconciliation-review');
    await review.updateComplete;
    const issueGroup = (type) => review.shadowRoot.querySelector(`.issue-class[data-issue-type="${type}"]`);
    expect(review.shadowRoot.querySelectorAll('.list .item')).toHaveLength(4);
    expect(issueGroup('containment').querySelector('summary').textContent)
      .toContain('Task dates outside ancestor bounds');
    expect(review.shadowRoot.querySelectorAll('.relationship')).toHaveLength(1);
    expect(issueGroup('containment').open).toBe(true);
    expect(review.shadowRoot.querySelector('.item[aria-pressed="true"] strong').textContent).toBe('Conflicted delivery');
    expect(review.shadowRoot.querySelectorAll('.task-detail .relationship')).toHaveLength(1);
    expect(review.shadowRoot.querySelector('.task-detail').textContent).toContain('finishes 12 days late');
    issueGroup('dependency-order').querySelector('.item').click();
    await review.updateComplete;
    expect(review.shadowRoot.querySelector('.task-detail').textContent).toContain('before "Programme"');
    expect(review.shadowRoot.querySelectorAll('.task-detail .relationship')).toHaveLength(1);
    const secondGroup = review.snapshot.groups.find((group) => group.featureId === 'second');
    review.shadowRoot.querySelector(`[data-task-id="${secondGroup.id}"]`).click();
    await review.updateComplete;
    expect(review.shadowRoot.querySelectorAll('.task-detail .relationship')).toHaveLength(1);
    expect(review.shadowRoot.querySelector('.item[aria-pressed="true"] strong').textContent).toBe('Second delivery');
    expect(review.shadowRoot.querySelector('.task-detail').textContent).not.toContain('finishes 12 days late');
    openReconciliationReview('schedule', 'schedule:conflicted');
    await review.updateComplete;
    expect(review.shadowRoot.querySelector('.task-detail').textContent).toContain('finishes 12 days late');
    openReconciliationReview('quality');

    const search = review.shadowRoot.querySelector('input');
    search.value = 'Second delivery';
    search.dispatchEvent(new Event('input'));
    await review.updateComplete;
    review.shadowRoot.querySelector('.item').click();
    await review.updateComplete;
    expect(review.shadowRoot.querySelectorAll('.relationship')).toHaveLength(1);
    expect(review.shadowRoot.querySelectorAll('.list .item')).toHaveLength(1);
    expect(review.shadowRoot.querySelector('.item[aria-pressed="true"] strong').textContent).toBe('Second delivery');
    search.value = '';
    search.dispatchEvent(new Event('input'));
    review.shadowRoot.querySelector('[data-category="schedule"]').click();
    await review.updateComplete;
    expect(review.shadowRoot.querySelectorAll('.list .item')).toHaveLength(2);
    expect(issueGroup('past-unfinished')).toBeNull();
    openReconciliationReview('schedule', 'schedule:conflicted');
    await review.updateComplete;
    store.setState({ ...state, baseline: { ...state.baseline,
      features: [parent, { ...conflicted, start: '2026-10-01', end: '2026-10-10', relations: [] },
        first, second, { ...conflicted, id: 'another-conflict', title: 'Another conflict' }] } }, true);
    await review.updateComplete;
    expect(review.shadowRoot.querySelectorAll('.relationship')).toHaveLength(0);
    expect(review.shadowRoot.querySelectorAll('.list .item')).toHaveLength(2);
    expect(review.shadowRoot.querySelector('.resolved-task h3').textContent).toBe('Conflicted delivery');
    expect(review.shadowRoot.querySelector('.task-detail').textContent).toContain('No remaining findings');
    expect(review.shadowRoot.querySelector('.item').getAttribute('aria-pressed')).toBe('false');
  });

  it('groups issue classes, expands task details inline and places a marker toggle at the top', async () => {
    const centerFeatureById = vi.fn();
    vi.spyOn(boardUtils, 'findInBoard').mockReturnValue({
      centerFeatureById, setReconciliationContext: vi.fn(async () => {}), updateComplete: Promise.resolve(true),
    });
    const { element } = await openMenu();
    const state = createInitialAppState();
    state.lifecycle.status = 'ready';
    state.baseline.projects = [{ id: 'project', name: 'Programme', type: 'project',
      work_item_display: displayFixture([['Feature']], { Working: 'InProgress' }),
       }];
    state.baseline.features = ['first', 'second'].map((id) => ({ process_id: 'process', id, title: id,
      project: 'project', type: 'Feature', state: 'Working', start: '2026-10-01',
      end: '2026-10-02', parentId: null, capacity: [], relations: [] }));
    state.selection.projectIds = ['project'];
    state.selection.featureStateNames = ['Working'];
    store.setState(state, true);
    await element.updateComplete;
    const issueClass = element.shadowRoot.querySelector('.issue-class[data-issue-type="past-unfinished"]');
    expect(issueClass).not.toBeNull();
    expect(issueClass.querySelector('summary').textContent).toContain('2');
    expect(element.shadowRoot.querySelector('.detail')).toBeNull();
    const toggle = element.shadowRoot.querySelector('.filters [data-action="toggle-markers"]');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    toggle.click();
    await element.updateComplete;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    issueClass.open = true;
    const second = element.snapshot.groups.find((group) => group.featureId === 'second');
    issueClass.querySelector(`[data-task-id="${second.id}"]`).click();
    await element.updateComplete;
    await element._presentationComplete;
    const selectedTask = issueClass.querySelector(`[data-task-id="${second.id}"]`).parentElement;
    expect(selectedTask.querySelector('.task-detail')).not.toBeNull();
    expect(selectedTask.querySelector('[data-action="open-task"]')).not.toBeNull();
    expect(element.shadowRoot.querySelectorAll('.task-detail')).toHaveLength(1);
    expect(centerFeatureById).toHaveBeenCalledWith('second');
    expect(element.shadowRoot.querySelector('.filters header #review-heading')).not.toBeNull();
    expect(toggle.closest('[role="group"]').getAttribute('aria-labelledby')).toBe('marker-label');
    expect(element.shadowRoot.querySelector('#marker-label').textContent).toBe('Board warning markers');
    expect(element.shadowRoot.querySelector('.categories').getAttribute('aria-labelledby')).toBe('issue-category-label');
    expect(element.shadowRoot.querySelector('.categories .category').classList.contains('segment-btn')).toBe(true);
    expect(element.shadowRoot.querySelector('.list > .section-title').textContent).toContain('Issues & actions');
    expect(selectedTask.querySelector('.item').textContent).not.toContain('1 finding');
    const calls = centerFeatureById.mock.calls.length;
    selectedTask.querySelector('.item').click();
    await element.updateComplete;
    await element._presentationComplete;
    expect(centerFeatureById).toHaveBeenCalledTimes(calls + 1);
    selectedTask.querySelector('.relationship summary').click();
    await element.updateComplete;
    await element._presentationComplete;
    expect(centerFeatureById).toHaveBeenCalledTimes(calls + 2);
    selectedTask.querySelector('.relationship summary').click();
    await element.updateComplete;
    await element._presentationComplete;
    expect(centerFeatureById).toHaveBeenCalledTimes(calls + 3);
  });

  it('counts multiple constraints within a class rather than other findings on the task', async () => {
    const { element } = await openMenu();
    const state = createInitialAppState();
    const task = { title: 'Delivery', project: 'project', state: 'Working',
      start: '2026-10-01', end: '2026-10-10', capacity: [], relations: [] };
    state.lifecycle.status = 'ready';
    state.baseline.projects = [{ id: 'project', name: 'Programme', type: 'project',
      work_item_display: displayFixture([['Initiative'], ['Epic'], ['Feature']], { Working: 'InProgress' }),  }];
    state.baseline.features = [
      { process_id: 'process', ...task, id: 'root', title: 'Programme', type: 'Initiative', parentId: null },
      { process_id: 'process', ...task, id: 'parent', title: 'Parent', type: 'Epic', parentId: 'root' },
      { process_id: 'process', ...task, id: 'child', type: 'Feature', parentId: 'parent', start: '2026-09-30', end: '2026-10-22',
        relations: [{ type: 'Predecessor', id: 'parent' }] },
    ];
    state.selection.projectIds = ['project'];
    state.selection.featureStateNames = ['Working'];
    state.selection.taskTypeNames = ["[\"process\",\"feature\"]"];
    store.setState(state, true);
    openReconciliationReview('schedule', 'schedule:child');
    await element.updateComplete;
    const containment = element.shadowRoot.querySelector('.issue-class[data-issue-type="containment"]');
    expect(containment.querySelector('.finding-count').textContent).toBe('2 findings in this class');
    expect(containment.querySelectorAll('.task-detail .relationship')).toHaveLength(2);
    expect(containment.querySelector('summary .count').textContent).toBe('1');
    const dependency = element.shadowRoot.querySelector('.issue-class[data-issue-type="dependency-order"]');
    expect(dependency).not.toBeNull();
    expect(dependency.querySelector('.finding-count')).toBeNull();
  });

  it('renders relevant context before auto-locating, keeps counts stable and clears it on close', async () => {
    const centerFeatureById = vi.fn();
    let finishRender;
    const board = { centerFeatureById, updateComplete: Promise.resolve(true),
      setReconciliationContext: vi.fn(() => new Promise((resolve) => { finishRender = resolve; })) };
    vi.spyOn(boardUtils, 'findInBoard').mockReturnValue(board);
    const { element, plugin } = await openMenu();
    const state = createInitialAppState();
    const parent = { process_id: 'process', id: 'parent', title: 'Programme', type: 'Epic', project: 'project',
      state: 'Working', start: '2026-10-01', end: '2026-10-10', capacity: [], relations: [], parentId: null };
    state.lifecycle.status = 'ready';
    state.baseline.projects = [{ id: 'project', name: 'Programme', type: 'project',
      work_item_display: displayFixture([['Epic'], ['Feature']], { Working: 'InProgress' }),
       }];
    state.baseline.features = [parent, { process_id: 'process', ...parent, id: 'child', type: 'Feature', parentId: 'parent', end: '2026-10-22' }];
    state.selection.projectIds = ['project'];
    state.selection.featureStateNames = ['Working'];
    store.setState(state, true);
    openReconciliationReview('schedule', 'schedule:child');
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('.filters [data-context="all"]')).not.toBeNull();
    expect(element.shadowRoot.querySelector('.task-detail [data-context]')).toBeNull();
    expect(board.setReconciliationContext).toHaveBeenLastCalledWith({
      filter: true, featureIds: new Set(['child', 'parent']),
    });
    expect(centerFeatureById).not.toHaveBeenCalled();
    finishRender();
    await element._presentationComplete;
    expect(centerFeatureById).toHaveBeenCalledTimes(1);
    expect(centerFeatureById).toHaveBeenCalledWith('child');
    const counts = plugin.getMetadata().attentionCounts;
    element.shadowRoot.querySelector('[data-context="all"]').click();
    await element.updateComplete;
    expect(board.setReconciliationContext).toHaveBeenLastCalledWith({
      filter: false, featureIds: new Set(['child', 'parent']),
    });
    finishRender();
    await element._presentationComplete;
    expect(centerFeatureById).toHaveBeenCalledTimes(2);
    expect(plugin.getMetadata().attentionCounts).toEqual(counts);
    element._onToggleToolbox();
    reconciliation.setMarkersVisible(!element.snapshot.markersVisible);
    await element.updateComplete;
    await element._presentationComplete;
    expect(centerFeatureById).toHaveBeenCalledTimes(2);
    element.close();
    expect(board.setReconciliationContext).toHaveBeenLastCalledWith(null);
    finishRender();
  });

  it('explains incomplete dependency context without invented drift or related-task actions', async () => {
    const { element } = await openMenu();
    const state = createInitialAppState();
    state.lifecycle.status = 'ready';
    state.baseline.projects = [{ id: 'project', name: 'Delivery plan', type: 'project',
      work_item_display: displayFixture([['Epic']], { Working: 'InProgress' }),  }];
    state.baseline.features = [{ process_id: 'process', id: 'child', title: 'Delivery', type: 'Epic', project: 'project',
      state: 'Working', start: '2026-10-01', end: '2026-10-10', parentId: null,
      capacity: [], relations: [{ id: 'unloaded', type: 'Predecessor' }] }];
    state.selection.projectIds = ['project'];
    state.selection.featureStateNames = ['Working'];
    store.setState(state, true);
    openReconciliationReview('schedule', 'schedule:child');
    await element.updateComplete;
    const finding = element.shadowRoot.querySelector('.relationship');
    expect(finding.textContent).toContain('Dependency context unavailable');
    expect(finding.textContent).toContain('Cannot assess');
    expect(finding.textContent).toContain('Delivery plan');
    expect(finding.textContent).toContain('Task unloaded (not loaded)');
    expect(finding.textContent).toContain('Affected plan unavailable');
    expect(finding.textContent).not.toContain('undefined');
    expect(finding.textContent).not.toContain('days early');
    expect([...finding.querySelectorAll('button')].some((button) =>
      button.textContent.includes('Open related task'))).toBe(false);
    expect(finding.querySelector('[data-action="edit-dependency"]')).toBeNull();
    expect(element.shadowRoot.querySelector('[data-action="open-task"]').title)
      .toContain('Delivery plan');
  });

  it('shows constraint, affected plans and per-finding scenario status separately from drift', async () => {
    const { element } = await openMenu();
    const state = createInitialAppState();
    const parent = { process_id: 'process', id: 'parent', title: 'Programme', type: 'Epic', project: 'programme',
      state: 'Working', start: '2026-10-01', end: '2026-10-10', parentId: null,
      capacity: [], relations: [] };
    state.lifecycle.status = 'ready';
    state.baseline.projects = ['programme', 'delivery'].map((id) => ({ id, name: `${id} plan`,
      type: 'project', work_item_display: displayFixture([['Epic'], ['Feature']], { Working: 'InProgress' }),
       }));
    state.baseline.features = [parent, { process_id: 'process', ...parent, id: 'child', title: 'Delivery',
      project: 'delivery', type: 'Feature', parentId: 'parent' }];
    state.selection.projectIds = ['delivery'];
    state.selection.featureStateNames = ['Working'];
    state.scenarios.items[0].overrides = { child: { end: '2026-10-22' } };
    store.setState(state, true);
    openReconciliationReview('schedule', 'schedule:child');
    await element.updateComplete;
    const finding = element.shadowRoot.querySelector('.relationship');
    expect(finding.textContent).toContain('Constraint');
    expect(finding.textContent).toContain('within');
    expect(finding.textContent).toContain('Owning plan');
    expect(finding.textContent).toContain('delivery plan');
    expect(finding.textContent).toContain('programme plan');
    expect(finding.textContent).toContain('12 days late');
    expect(finding.textContent).toContain('New');
    expect(finding.textContent).toContain('Cross-plan impact');
    expect(finding.textContent).toContain('Opening or locating tasks does not change task data');
  });

  it('opens a non-modal toolbox, retains hidden state and returns focus on dismissal', async () => {
    await openMenu();
    document.querySelector('reconciliation-review').close();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    openReconciliationReview();
    const review = document.querySelector('reconciliation-review');
    await review.updateComplete;
    const toolbox = review.shadowRoot.querySelector('[role="region"]');
    expect(toolbox.getAttribute('aria-labelledby')).toBe('review-heading');
    expect(review.shadowRoot.querySelector('dialog')).toBeNull();
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
    const search = review.shadowRoot.querySelector('input[type="search"]');
    search.value = 'retained search';
    search.dispatchEvent(new Event('input'));
    search.focus();
    review.shadowRoot.querySelector('[aria-label="Hide reconciliation toolbox"]').click();
    await review.updateComplete;
    expect(toolbox.hidden).toBe(true);
    expect(toolbox.hasAttribute('inert')).toBe(true);
    const restore = review.shadowRoot.querySelector('[aria-label="Show reconciliation toolbox"]');
    expect(review.shadowRoot.activeElement).toBe(restore);
    restore.click();
    await review.updateComplete;
    expect(toolbox.hidden).toBe(false);
    expect(search.value).toBe('retained search');
    toolbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('reconciliation-review')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('orders category task counts and distinguishes empty scope from health', async () => {
    const { plugin, element } = await openMenu();
    expect([...element.shadowRoot.querySelectorAll('[data-category]')]
      .map((button) => button.dataset.category)).toEqual(['quality', 'schedule']);
    expect(plugin.getMetadata().attentionCounts.map((category) => category.id))
      .toEqual(['quality', 'schedule']);
    const state = createInitialAppState();
    state.lifecycle.status = 'ready';
    store.setState(state, true);
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('[role="status"]').textContent)
      .toContain('No tasks in the current scope');
    expect(plugin.getMetadata().attentionCounts.every((category) => category.count === 0)).toBe(true);
    store.setState({ ...state, lifecycle: { ...state.lifecycle, status: 'error' } }, true);
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('[role="status"]').textContent)
      .toContain('Plan data unavailable');
    expect(plugin.getMetadata().attentionStatus).toContain('cannot be assessed');
  });
});