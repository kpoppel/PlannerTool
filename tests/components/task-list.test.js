import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import '../../www/js/components/TaskList.lit.js';
import { store } from '../../www/js/application/store.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { cmd } from '../../www/js/application/imports.js';

describe('Task list presentation', () => {
  let list;
  beforeEach(async () => {
    store.setState(createInitialAppState(), true);
    list = document.createElement('task-list');
    list.layout = { height: 900, swimlanes: [], groups: [], rows: [
      { id: 'group', isGroup: true, top: 0, height: 28, groupObj: { name: 'Release' }, collapsed: false },
      { id: '42', top: 28, height: 60, feature: { id: '42', title: 'Ship release', parentId: null },
        foldCount: 2, folded: false },
    ], searchFeatures: [{ id: '42', title: 'Ship release' }] };
    document.body.append(list);
    await list.updateComplete;
  });
  afterEach(() => { list.remove(); vi.restoreAllMocks(); });

  it('uses supplied row positions and emits ID-based folding and context actions', async () => {
    const row = list.shadowRoot.querySelector('[data-task-id="42"]');
    expect(row.style.top).toBe('28px');
    expect(row.style.height).toBe('60px');
    expect(list.shadowRoot.querySelector('.rows').style.height).toBe('900px');
    const fold = vi.fn();
    list.addEventListener('feature-fold-toggle', fold);
    row.querySelector('.fold').click();
    expect(fold.mock.calls[0][0].detail.featureId).toBe('42');
    const context = vi.fn();
    list.addEventListener('feature-context-menu', context);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(context.mock.calls[0][0].detail.feature.id).toBe('42');
  });

  it('navigates title and ID matches without changing view, filters, or layout', async () => {
    const state = store.getState();
    const layout = list.layout;
    const navigate = vi.fn();
    list.addEventListener('task-navigate', navigate);
    list.query = 'ship';
    await list.updateComplete;
    list.navigateMatch(1);
    expect(navigate.mock.calls[0][0].detail.id).toBe('42');
    list.query = '42';
    await list.updateComplete;
    list.navigateMatch(-1);
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(store.getState()).toBe(state);
    expect(list.layout).toBe(layout);
    list.query = 'missing';
    await list.updateComplete;
    list.navigateMatch(1);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('selects tasks through the shared command without starting background panning', () => {
    const selected = vi.spyOn(cmd.feature, 'setSelectedFeature');
    const background = vi.fn();
    list.parentElement.addEventListener('mousedown', background, { once: true });
    const row = list.shadowRoot.querySelector('[data-task-id="42"]');
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    row.querySelector('.task-title').click();
    expect(background).not.toHaveBeenCalled();
    expect(selected).toHaveBeenCalledWith(list.layout.rows[1].feature);
  });
});