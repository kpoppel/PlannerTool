import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import {
  createLegacyFeatureSelectors,
  createFeatureSelectors,
} from '../../www/js/application/selectors/featureSelectors.js';
import { store } from '../../www/js/application/store.js';

function seedStore() {
  return {
    ...createInitialAppState(),
    baseline: {
      ...createInitialAppState().baseline,
      features: [
        { id: 'f1', title: 'A', state: 'Todo', start: '2026-01-01', end: '2026-01-10' },
        { id: 'f2', title: 'B', state: 'Doing', start: '2026-02-01', end: '2026-02-10' },
      ],
    },
    scenarios: {
      activeId: 's1',
      items: [
        {
          id: 's1',
          name: 'Scenario 1',
          overrides: {
            f2: { state: 'Done', end: '2026-02-12' },
          },
        },
      ],
    },
  };
}

describe('application/selectors/featureSelectors', () => {
  beforeEach(() => {
    store.setState(seedStore(), true, 'test.resetStore');
  });

  it('legacy selector delegates to state methods', () => {
    const state = {
      getEffectiveFeatures: vi.fn(() => [{ id: 'x1' }]),
      getEffectiveFeatureById: vi.fn(() => ({ id: 'x2' })),
    };

    const selectors = createLegacyFeatureSelectors(state);

    expect(selectors.getEffectiveFeatures()).toEqual([{ id: 'x1' }]);
    expect(selectors.getEffectiveFeatureById('x2')).toEqual({ id: 'x2' });
    expect(state.getEffectiveFeatureById).toHaveBeenCalledWith('x2');
  });

  it('store selector overlays active scenario overrides onto baseline', () => {
    const selectors = createFeatureSelectors(store);

    const all = selectors.getEffectiveFeatures();
    const f2 = selectors.getEffectiveFeatureById('f2');

    expect(all).toHaveLength(2);
    expect(f2).toEqual(
      expect.objectContaining({ id: 'f2', state: 'Done', end: '2026-02-12' })
    );
  });

  it('store selector applies baseline overrides when baseline is active', () => {
    store.setState(
      {
        ...seedStore(),
        scenarios: {
          activeId: 'baseline',
          items: [
            {
              id: 'baseline',
              name: 'Baseline',
              readonly: true,
              overrides: {
                f1: { start: '2026-03-01', end: '2026-03-10' },
              },
            },
          ],
        },
      },
      true,
      'test.resetStore.baselineActiveOverrides'
    );

    const selectors = createFeatureSelectors(store);
    const f1 = selectors.getEffectiveFeatureById('f1');

    expect(f1).toEqual(
      expect.objectContaining({ id: 'f1', start: '2026-03-01', end: '2026-03-10' })
    );
  });

  it('store selector does not touch legacy featureService during expansion calculations', () => {
    const seen = [];
    const legacyState = new Proxy({}, {
      get(target, prop) {
        seen.push(prop);
        if (prop === 'featureService') {
          throw new Error('legacy featureService should not be touched in store mode');
        }
        return undefined;
      },
    });

    const selectors = createFeatureSelectors(store, legacyState);
    const result = selectors.computeExpandedFeatureSet(['f1'], {
      expandParentChild: true,
      expandRelations: false,
      expandTeamAllocated: false,
      selectedTeamIds: [],
    });

    expect(result.expandedIds.has('f1')).toBe(true);
    expect(seen).not.toContain('featureService');
  });
});
