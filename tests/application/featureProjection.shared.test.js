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
          { id: 'f1', state: 'Todo', start: '2026-01-01', end: '2026-01-02' },
          { id: 'f2', state: 'Doing', start: '2026-01-03', end: '2026-01-04' },
        ],
      },
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
        features: [{ id: 'f1', state: 'Todo' }],
      },
      scenarios: {
        activeId: 's1',
        items: [{ id: 's1', overrides: { f1: { state: 'Done' } } }],
      },
    };

    const features = deriveEffectiveFeatures(state, { includeDirtyMetadata: false });
    expect(features[0]).toEqual({ id: 'f1', state: 'Done' });
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
