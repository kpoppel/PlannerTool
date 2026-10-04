import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PluginRegistry from '../../www/js/core/pluginRegistry.js';
import modulesConfig from '../../www/js/modules.config.json';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { reconciliation } from '../../www/js/plugins/reconciliation/runtime.js';
import * as boardUtils from '../../www/js/components/board-utils.js';
import { openReconciliationReview } from '../../www/js/plugins/reconciliation/ReconciliationReview.lit.js';
import '../../www/js/plugins/reconciliation/ReconciliationTaskMarker.lit.js';

const config = modulesConfig.modules.find((entry) => entry.id === 'plugin-reconciliation');
const schemaFiles = import.meta.glob('../../www/js/plugins/*.schema.json', {
  query: '?raw', import: 'default', eager: true,
});

describe('Reconciliation detection menu', () => {
  const plugins = [];
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

  it('registers an enabled nonexclusive menu, not a startup tool', () => {
    expect(config.type).toBe('menu');
    expect(config.enabled).toBe(true);
    expect(config.activateOnStartup).toBe(false);
    expect(config.exclusive).toBe(false);
    expect(config.menuPosition).toBe('before-tools');
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
    const parent = { id: 'parent', title: 'Programme', type: 'Epic', project: 'project',
      state: 'Working', start: '2026-10-01', end: '2026-10-10', capacity: [], relations: [],
      parentId: null };
    const child = { ...parent, id: 'child', title: 'Delivery', type: 'Feature', parentId: 'parent' };
    state.lifecycle.status = 'ready';
    state.baseline.projects = [{ id: 'project', name: 'Programme', type: 'project',
      state_categories: { Working: 'InProgress' },
      task_type_hierarchy: [{ types: ['Epic'] }, { types: ['Feature'] }] }];
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
    const parent = { id: 'parent', title: 'Programme', type: 'Epic', project: 'project',
      state: 'Working', start: '2026-10-01', end: '2026-10-10', capacity: [], relations: [],
      parentId: null };
    const child = { ...parent, id: 'child', title: 'Delivery', type: 'Feature', parentId: 'parent' };
    state.lifecycle.status = 'ready';
    state.baseline.projects = [{ id: 'project', name: 'Programme', type: 'project',
      state_categories: { Working: 'InProgress' },
      task_type_hierarchy: [{ types: ['Epic'] }, { types: ['Feature'] }] }];
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
    const parent = { id: 'parent', title: 'Programme', type: 'Epic', project: 'project',
      state: 'Working', start: '2026-10-01', end: '2026-10-10', capacity: [], relations: [],
      parentId: null };
    const conflicted = { ...parent, id: 'conflicted', title: 'Conflicted delivery',
      type: 'Feature', parentId: 'parent', start: '2026-09-30', end: '2026-10-22',
      relations: [{ type: 'Predecessor', id: 'parent' }] };
    const first = { ...parent, id: 'first', title: 'First delivery', type: 'Feature',
      parentId: 'parent', end: '2026-10-02' };
    const second = { ...first, id: 'second', title: 'Second delivery' };
    state.lifecycle.status = 'ready';
    state.baseline.projects = [{ id: 'project', name: 'Programme', type: 'project',
      state_categories: { Working: 'InProgress' },
      task_type_hierarchy: [{ types: ['Epic'] }, { types: ['Feature'] }] }];
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
      state_categories: { Working: 'InProgress' },
      task_type_hierarchy: [{ types: ['Feature'] }] }];
    state.baseline.features = ['first', 'second'].map((id) => ({ id, title: id,
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
      state_categories: { Working: 'InProgress' }, task_type_hierarchy: [
        { types: ['Initiative'] }, { types: ['Epic'] }, { types: ['Feature'] },
      ] }];
    state.baseline.features = [
      { ...task, id: 'root', title: 'Programme', type: 'Initiative', parentId: null },
      { ...task, id: 'parent', title: 'Parent', type: 'Epic', parentId: 'root' },
      { ...task, id: 'child', type: 'Feature', parentId: 'parent', start: '2026-09-30', end: '2026-10-22',
        relations: [{ type: 'Predecessor', id: 'parent' }] },
    ];
    state.selection.projectIds = ['project'];
    state.selection.featureStateNames = ['Working'];
    state.selection.taskTypeNames = ['Feature'];
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
    const parent = { id: 'parent', title: 'Programme', type: 'Epic', project: 'project',
      state: 'Working', start: '2026-10-01', end: '2026-10-10', capacity: [], relations: [], parentId: null };
    state.lifecycle.status = 'ready';
    state.baseline.projects = [{ id: 'project', name: 'Programme', type: 'project',
      state_categories: { Working: 'InProgress' },
      task_type_hierarchy: [{ types: ['Epic'] }, { types: ['Feature'] }] }];
    state.baseline.features = [parent, { ...parent, id: 'child', type: 'Feature', parentId: 'parent', end: '2026-10-22' }];
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