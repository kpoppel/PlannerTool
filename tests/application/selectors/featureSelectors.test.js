import { describe, expect, it } from 'vitest';
import { createFeatureSelectors } from '../../../www/js/application/selectors/featureSelectors.js';

function makeState(features) {
  return {
    baseline: { features, teams: [] },
    scenarios: { activeId: 'baseline', items: [{ id: 'baseline', overrides: {} }] },
  };
}

describe('featureSelectors.getChildrenByParentMap', () => {
  it('caches descendant allocation teams and refreshes them after scenario edits', () => {
    let state = makeState([
      { id: 'parent', capacity: [{ team: 'A', capacity: 50 }] },
      { id: 'child', parentId: 'parent', start: '2026-01-01', end: '2026-01-15',
        capacity: [] },
    ]);
    const selectors = createFeatureSelectors({ getState: () => state });
    const first = selectors.getDescendantAllocationTeams('parent');
    expect([...first]).toEqual([]);
    expect(selectors.getDescendantAllocationTeams('parent')).toBe(first);

    state = { ...state, scenarios: { activeId: 'baseline', items: [{ id: 'baseline',
      overrides: { child: { capacity: [{ team: 'A', capacity: 25 }] } } }] } };
    expect([...selectors.getDescendantAllocationTeams('parent')]).toEqual(['A']);
    expect(selectors.getDescendantAllocationTeams('parent')).not.toBe(first);
  });

  it('reuses the derived map while the store state is unchanged', () => {
    let state = makeState([{ id: 'p' }, { id: 'c', parentId: 'p' }]);
    const selectors = createFeatureSelectors({ getState: () => state });

    const first = selectors.getChildrenByParentMap();
    expect(first.get('p')).toEqual(['c']);
    expect(selectors.getChildrenByParentMap()).toBe(first);

    state = makeState([{ id: 'p' }, { id: 'c', parentId: 'p' }, { id: 'd', parentId: 'p' }]);
    const next = selectors.getChildrenByParentMap();
    expect(next).not.toBe(first);
    expect(next.get('p')).toEqual(['c', 'd']);
  });
});
