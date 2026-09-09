import { describe, expect, it } from 'vitest';
import {
  buildChildrenByParentMap,
  deriveEffectiveFeatures,
} from '../../www/js/application/shared/featureProjection.js';

describe('application/shared/featureProjection', () => {
  it('derives effective features from active scenario overrides', () => {
    const state = {
      baseline: {
        features: [
          { id: 'f1', state: 'Todo', start: '2026-01-01', end: '2026-01-02', capacity: [] },
          { id: 'f2', state: 'Doing', start: '2026-01-03', end: '2026-01-04', capacity: [] },
        ],
      },
      selection: { teamIds: [] },
      scenarios: {
        activeId: 's1',
        items: [
          {
            id: 's1',
            overrides: {
              f2: { state: 'Done', end: '2026-01-08' },
            },
          },
        ],
      },
    };

    const features = deriveEffectiveFeatures(state);
    expect(features[1]).toEqual(
      expect.objectContaining({
        id: 'f2',
        state: 'Done',
        end: '2026-01-08',
        scenarioOverride: true,
        dirty: true,
      })
    );
  });

  it('supports raw merge mode for non-selector paths', () => {
    const state = {
      baseline: {
        features: [{ id: 'f1', state: 'Todo', capacity: [] }],
      },
      selection: { teamIds: [] },
      scenarios: {
        activeId: 's1',
        items: [{ id: 's1', overrides: { f1: { state: 'Done' } } }],
      },
    };

    const features = deriveEffectiveFeatures(state, { includeDirtyMetadata: false });
    expect(features[0]).toEqual({ id: 'f1', state: 'Done', capacity: [] });
  });

  it('derives orgLoad as the selected-team allocation average', () => {
    const state = {
      baseline: {
        features: [
          {
            id: 'f1',
            capacity: [
              { team: 't1', capacity: 10 },
              { team: 't2', capacity: 10 },
              { team: 't3', capacity: 10 },
              { team: 't4', capacity: 10 },
            ],
          },
        ],
      },
      // 5 selected teams, only 4 of which carry an allocation on f1.
      selection: { teamIds: ['t1', 't2', 't3', 't4', 't5'] },
      scenarios: {
        activeId: 'baseline',
        items: [{ id: 'baseline', overrides: {} }],
      },
    };

    expect(deriveEffectiveFeatures(state)[0].orgLoad).toBe('8.0%');
  });

  it('excludes deselected teams from both numerator and denominator of orgLoad', () => {
    const state = {
      baseline: {
        features: [
          {
            id: 'f1',
            capacity: [
              { team: 't1', capacity: 40 },
              { team: 't2', capacity: 20 },
            ],
          },
        ],
      },
      selection: { teamIds: ['t1'] },
      scenarios: {
        activeId: 'baseline',
        items: [{ id: 'baseline', overrides: {} }],
      },
    };

    expect(deriveEffectiveFeatures(state)[0].orgLoad).toBe('40.0%');
  });

  it('derives orgLoad from scenario-overridden capacity', () => {
    const state = {
      baseline: {
        features: [{ id: 'f1', capacity: [{ team: 't1', capacity: 10 }] }],
      },
      selection: { teamIds: ['t1', 't2'] },
      scenarios: {
        activeId: 's1',
        items: [
          {
            id: 's1',
            overrides: {
              f1: {
                capacity: [
                  { team: 't1', capacity: 50 },
                  { team: 't2', capacity: 30 },
                ],
              },
            },
          },
        ],
      },
    };

    expect(deriveEffectiveFeatures(state)[0].orgLoad).toBe('40.0%');
  });

  it('derives orgLoad of 0.0% when no teams are selected', () => {
    const state = {
      baseline: {
        features: [{ id: 'f1', capacity: [{ team: 't1', capacity: 10 }] }],
      },
      selection: { teamIds: [] },
      scenarios: {
        activeId: 'baseline',
        items: [{ id: 'baseline', overrides: {} }],
      },
    };

    expect(deriveEffectiveFeatures(state)[0].orgLoad).toBe('0.0%');
  });

  it('builds children-by-parent maps from feature lists', () => {
    const map = buildChildrenByParentMap([
      { id: 'f1' },
      { id: 'f2', parentId: 'f1' },
      { id: 'f3', parentId: 'f1' },
      { id: 'f4', parentId: 'f2' },
    ]);

    expect(map.get('f1')).toEqual(['f2', 'f3']);
    expect(map.get('f2')).toEqual(['f4']);
  });
});
