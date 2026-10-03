import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReconciliationController } from '../../www/js/plugins/reconciliation/ReconciliationController.js';

function fixture() {
  const parent = { id: 'parent', title: 'Programme', project: 'project', type: 'Epic',
    state: 'Active', start: '2026-10-01', end: '2026-10-10', parentId: null,
    capacity: [], relations: [] };
  const child = { ...parent, id: 'child', title: 'Delivery', type: 'Feature', parentId: 'parent' };
  let state = {
    lifecycle: { status: 'bootstrapping' },
    baseline: { features: [parent, child], projects: [{ id: 'project', name: 'Programme',
      type: 'project', state_categories: { Active: 'InProgress' } }] },
    scenarios: { activeId: 'baseline', items: [{ id: 'baseline', name: 'Baseline' }] },
  };
  let effective = state.baseline.features;
  let onState;
  const unsubscribe = vi.fn();
  const store = { getState: () => state, subscribe: (listener) => {
    onState = listener;
    return unsubscribe;
  } };
  const selectors = {
    scope: { getResolvedFeatures: () => effective, getVisibleFeatures: () => [effective[1]] },
    feature: { getTaskTypeHierarchy: () => [{ types: ['Epic'] }, { types: ['Feature'] }] },
  };
  const clock = () => new Date('2026-10-03T12:00:00');
  const controller = new ReconciliationController({ store, selectors, clock });
  return { controller, unsubscribe, update: (values, features = effective) => {
    state = { ...state, ...values };
    effective = features;
    onState();
  }, ready: () => {
    state = { ...state, lifecycle: { status: 'ready' } };
    onState();
  }, parent, child };
}

describe('Live Reconciliation controller', () => {
  afterEach(() => vi.useRealTimers());

  it('updates while no menu is connected, marks visible relatives, and cleans up', () => {
    vi.useFakeTimers();
    const { controller, ready, update, parent, child, unsubscribe } = fixture();
    const changed = vi.fn();
    const stopListening = controller.subscribe(changed);
    controller.start();
    expect(controller.snapshot.status).toBe('loading');
    ready();
    expect(controller.snapshot.status).toBe('ready');
    expect(controller.snapshot.groups).toHaveLength(0);
    update({}, [parent, { ...child, end: '2026-10-22' }]);
    expect(controller.snapshot.groups).toHaveLength(1);
    expect(controller.snapshot.groups[0].change).toBe('new');
    expect(controller.issuesForFeature('child')).toHaveLength(1);
    expect(controller.issuesForFeature('parent')).toHaveLength(1);
    expect(controller.snapshot.visibleIds.has('parent')).toBe(false);
    expect(changed).toHaveBeenCalled();
    stopListening();
    controller.stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(controller.snapshot.status).toBe('inactive');
  });

  it('groups ancestor conflicts by task and keeps unavailable data distinct from healthy', () => {
    vi.useFakeTimers();
    const { controller, ready, update, parent, child } = fixture();
    controller.start();
    ready();
    const root = { ...parent, id: 'root', end: '2026-10-09' };
    update({}, [root, { ...child, end: '2026-10-22' }, { ...parent, parentId: 'root' }]);
    expect(controller.snapshot.groups).toHaveLength(1);
    expect(controller.snapshot.groups[0].issues).toHaveLength(2);
    update({ lifecycle: { status: 'failed' } });
    expect(controller.snapshot.status).toBe('unavailable');
    expect(controller.snapshot.groups).toHaveLength(0);
    controller.stop();
  });

  it('refreshes date-based findings after midnight without a task edit', () => {
    vi.useFakeTimers();
    const { controller, ready, update, parent, child } = fixture();
    let day = new Date('2026-10-10T12:00:00');
    controller.clock = () => day;
    controller.start();
    ready();
    update({}, [parent, child]);
    expect(controller.snapshot.issues).toHaveLength(0);
    day = new Date('2026-10-11T00:00:00');
    vi.advanceTimersByTime(60000);
    expect(controller.snapshot.issues.some((issue) => issue.type === 'past-unfinished')).toBe(true);
    controller.stop();
  });
});