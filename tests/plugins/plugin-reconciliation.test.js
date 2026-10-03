import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PluginRegistry from '../../www/js/core/pluginRegistry.js';
import modulesConfig from '../../www/js/modules.config.json';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { reconciliation } from '../../www/js/plugins/reconciliation/runtime.js';
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
    HTMLDialogElement.prototype.showModal = vi.fn(function () { this.setAttribute('open', ''); });
    HTMLDialogElement.prototype.close = vi.fn(function () { this.removeAttribute('open'); });
  });
  afterEach(() => {
    for (const plugin of plugins.splice(0)) plugin.destroy();
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  async function openMenu() {
    const plugin = new PluginRegistry[config.id](config.id, config);
    plugins.push(plugin);
    await plugin.init();
    const element = plugin.createMenuElement();
    document.body.appendChild(element);
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

  it('requires initialization before creating its menu', () => {
    const plugin = new PluginRegistry[config.id](config.id, config);
    expect(() => plugin.createMenuElement()).toThrow('not initialized');
  });

  it('opens without activation and reports loading rather than a fabricated empty queue', async () => {
    const { plugin, element } = await openMenu();
    expect(plugin.initialized).toBe(true);
    expect(plugin.active).toBe(false);
    expect(element.shadowRoot.querySelectorAll('[data-category]')).toHaveLength(2);
    expect(element.shadowRoot.querySelector('[role="status"]').textContent)
      .toContain('Loading');
    expect(element.shadowRoot.querySelector('input[type="checkbox"]').checked).toBe(true);
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
    expect(element.shadowRoot.querySelector('h2')).toBeNull();
    expect(element.shadowRoot.querySelector('.close')).toBeNull();
    expect(element.shadowRoot.querySelectorAll('.issue')).toHaveLength(0);
    expect(element.shadowRoot.querySelector('.review')).toBeNull();
    expect(element.shadowRoot.textContent).not.toContain(reconciliation.snapshot.scenarioName);
    expect(element.shadowRoot.querySelector('[data-category="schedule"] .count').textContent)
      .toBe('1');
    expect(element.shadowRoot.querySelector('[data-category="quality"] .count').textContent)
      .toBe('0');
    let closeEvent;
    element.addEventListener('menu-close', (event) => { closeEvent = event; }, { once: true });
    element.shadowRoot.querySelector('[data-category="schedule"]').click();
    expect(closeEvent.bubbles).toBe(true);
    expect(closeEvent.composed).toBe(true);
    const categoryReview = document.querySelector('reconciliation-review');
    await categoryReview.updateComplete;
    expect(categoryReview.category).toBe('schedule');
    expect(categoryReview.shadowRoot.querySelector('[aria-label="Issue category"]').value)
      .toBe('schedule');
    expect(categoryReview.shadowRoot.querySelector('.detail h3').textContent).toBe('Delivery');
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
    review.shadowRoot.querySelector('[data-action="open-task"]').click();
    expect(store.getState().featureDisplay.selectedId).toBe('child');
    expect(document.querySelector('reconciliation-review')).toBeNull();
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
    const toggle = element.shadowRoot.querySelector('input[type="checkbox"]');
    expect(toggle.checked).toBe(true);
    toggle.click();
    await marker.updateComplete;
    await element.updateComplete;
    expect(marker.shadowRoot.querySelector('button')).toBeNull();
    expect(toggle.checked).toBe(false);
    expect(plugin.getMetadata().attentionCount).toBe(1);
    expect(element.shadowRoot.querySelector('[data-category="schedule"] .count').textContent).toBe('1');
    state.scenarios.items[0].overrides.child.end = '2026-10-23';
    store.setState({ ...state, baseline: { ...state.baseline, features: [...state.baseline.features] } }, true);
    await marker.updateComplete;
    expect(marker.shadowRoot.querySelector('button')).toBeNull();
    element.remove();
    document.body.appendChild(element);
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('input[type="checkbox"]').checked).toBe(false);
    element.shadowRoot.querySelector('input[type="checkbox"]').click();
    await marker.updateComplete;
    expect(marker.shadowRoot.querySelector('button').title).toContain('13 days late');
  });

  it('groups matching issue types with counts while keeping each task and relationship distinct', async () => {
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
    const issueGroup = (type) => review.shadowRoot.querySelector(`[data-issue-type="${type}"]`);
    expect(review.shadowRoot.querySelectorAll('[data-issue-type]')).toHaveLength(3);
    expect(issueGroup('past-unfinished').querySelector('summary').textContent)
      .toContain('Past finish date, still unfinished');
    expect(issueGroup('past-unfinished').querySelector('.count').textContent).toBe('2');
    expect(issueGroup('past-unfinished').querySelectorAll('.item')).toHaveLength(2);
    expect(issueGroup('containment').open).toBe(true);
    expect(issueGroup('containment').textContent).toContain('High impact');
    expect(issueGroup('dependency-order').textContent).not.toContain('High impact');
    expect(review.shadowRoot.querySelector('.detail h3').textContent).toBe('Conflicted delivery');
    issueGroup('dependency-order').querySelector('.item').click();
    await review.updateComplete;
    expect(review.shadowRoot.querySelectorAll('.detail .relationship')).toHaveLength(1);
    expect(review.shadowRoot.querySelector('.detail').textContent).toContain('before "Programme"');
    expect(review.shadowRoot.querySelector('.detail').textContent).not.toContain('finishes 12 days late');
    openReconciliationReview('schedule', 'schedule:conflicted');
    await review.updateComplete;
    expect(review.shadowRoot.querySelector('.detail').textContent).toContain('finishes 12 days late');
    openReconciliationReview();

    const search = review.shadowRoot.querySelector('input');
    search.value = 'Second delivery';
    search.dispatchEvent(new Event('input'));
    await review.updateComplete;
    expect(review.shadowRoot.querySelectorAll('[data-issue-type]')).toHaveLength(1);
    expect(issueGroup('past-unfinished').querySelector('.count').textContent).toBe('1');
    expect(review.shadowRoot.querySelector('.detail h3').textContent).toBe('Second delivery');
    search.value = '';
    search.dispatchEvent(new Event('input'));
    const category = review.shadowRoot.querySelector('select');
    category.value = 'schedule';
    category.dispatchEvent(new Event('change'));
    await review.updateComplete;
    expect(review.shadowRoot.querySelectorAll('[data-issue-type]')).toHaveLength(2);
    expect(issueGroup('past-unfinished')).toBeNull();
    store.setState({ ...state, baseline: { ...state.baseline,
      features: [parent, { ...conflicted, start: '2026-10-01', end: '2026-10-10' }, first, second] } }, true);
    await review.updateComplete;
    expect(review.shadowRoot.querySelectorAll('[data-issue-type]')).toHaveLength(0);
    expect(review.shadowRoot.textContent).toContain('No matching issues');
    expect(review.shadowRoot.querySelector('.detail h3')).toBeNull();
  });

  it('opens a searchable review dialog and removes it on keyboard dismissal', async () => {
    await openMenu();
    openReconciliationReview();
    const review = document.querySelector('reconciliation-review');
    await review.updateComplete;
    const dialog = review.shadowRoot.querySelector('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBe('review-heading');
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
    expect(review.shadowRoot.querySelector('input[type="search"]')).not.toBeNull();
    dialog.dispatchEvent(new Event('cancel'));
    expect(document.querySelector('reconciliation-review')).toBeNull();
  });
});