import { describe, expect, it } from 'vitest';
import {
  getActiveScenarioId,
  getScenarioItems,
  withActiveScenario,
} from '../../www/js/application/shared/scenarioMutations.js';

describe('application/shared/scenarioMutations', () => {
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
    expect(mutation.items.find((item) => item.id === 's2')?.name).toBe('Updated');
    expect(mutation.items.find((item) => item.id === 's1')?.name).toBe('S1');
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
});
