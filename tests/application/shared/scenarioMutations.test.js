import { describe, expect, it } from 'vitest';
import {
  getActiveScenario,
  getActiveScenarioId,
  getScenarioItems,
  getScenarioAccess,
  withActiveScenario,
} from '../../../www/js/application/shared/scenarioMutations.js';

describe('application/shared/scenarioMutations', () => {
  it('resolves access for baseline, locked, editable and missing targets', () => {
    const state = { scenarios: { activeId: 'owned', items: [
      { id: 'baseline', readonly: false }, { id: 'locked', readonly: true },
      { id: 'owned', readonly: false },
      { id: 'shared', readonly: false, access: { canEdit: false, reason: 'not-owner' } },
    ] } };
    expect(getScenarioAccess(state, 'baseline')).toEqual({ canEdit: false, reason: 'baseline' });
    expect(getScenarioAccess(state, 'locked')).toEqual({ canEdit: false, reason: 'read-only' });
    expect(getScenarioAccess(state, 'owned')).toEqual({ canEdit: true, reason: null });
    expect(getScenarioAccess(state, 'missing')).toEqual({ canEdit: false, reason: 'missing' });
    expect(getScenarioAccess(state, 'shared')).toEqual({ canEdit: false, reason: 'not-owner' });
    state.scenarios.activeId = 'baseline';
    expect(withActiveScenario(state, () => { throw new Error('Must not edit baseline'); })).toBeNull();
  });

  it('applies updater only to active mutable scenario', () => {
    const state = {
      scenarios: {
        activeId: 's2',
        items: [
          { id: 'baseline', readonly: true },
          { id: 's1', readonly: false, name: 'S1' },
          { id: 's2', readonly: false, name: 'S2' },
        ],
      },
    };

    const mutation = withActiveScenario(state, (scenario) => ({
      ...scenario,
      name: 'Updated',
    }));

    expect(mutation).toBeTruthy();
    expect(mutation.activeId).toBe('s2');
    expect(mutation.items.find((item) => item.id === 's2').name).toBe('Updated');
    expect(mutation.items.find((item) => item.id === 's1').name).toBe('S1');
  });

  it('returns null when baseline mutations are disallowed', () => {
    const state = {
      scenarios: {
        activeId: 'baseline',
        items: [{ id: 'baseline', readonly: true, name: 'Baseline' }],
      },
    };

    const mutation = withActiveScenario(
      state,
      (scenario) => ({ ...scenario, name: 'Mutated' }),
      { allowBaseline: false }
    );

    expect(mutation).toBeNull();
    expect(getActiveScenarioId(state)).toBe('baseline');
    expect(getScenarioItems(state)).toHaveLength(1);
  });

  it('returns active scenario and null when active id is missing', () => {
    const withActive = {
      scenarios: {
        activeId: 's1',
        items: [{ id: 'baseline', readonly: true }, { id: 's1', readonly: false }],
      },
    };
    const withMissingActiveId = {
      scenarios: {
        activeId: null,
        items: [{ id: 'baseline', readonly: true }, { id: 's1', readonly: false }],
      },
    };

    expect(getActiveScenario(withActive)).toEqual(expect.objectContaining({ id: 's1' }));
    expect(getActiveScenario(withMissingActiveId)).toBeNull();
  });
});
