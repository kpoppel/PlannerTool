import { describe, expect, it } from 'vitest';
import { createFeatureSelectors } from '../../../www/js/application/selectors/featureSelectors.js';

function makeState(features) {
  return {
    baseline: { features, teams: [] },
    scenarios: { activeId: 'baseline', items: [{ id: 'baseline', overrides: {} }] },
  };
}

describe('featureSelectors.getChildrenByParentMap', () => {
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
