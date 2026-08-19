import { describe, expect, it } from 'vitest';
import {
  deriveAvailableFeatureStates,
  deriveAvailableTaskTypes,
  deriveConfiguredStateSequence,
  deriveOrderedFeatureStateNames,
} from '../../www/js/application/shared/stateDerivations.js';

describe('application/shared/stateDerivations', () => {
  it('derives unique feature states in first-seen order', () => {
    const states = deriveAvailableFeatureStates([
      { id: 'f1', state: 'Doing' },
      { id: 'f2', state: 'Todo' },
      { id: 'f3', state: 'Doing' },
      { id: 'f4' },
    ]);

    expect(states).toEqual(['Doing', 'Todo']);
  });

  it('derives unique task types from canonical type field', () => {
    const types = deriveAvailableTaskTypes([
      { id: 'f1', type: 'Feature' },
      { id: 'f2', type: 'Epic' },
      { id: 'f3', type: 'Feature' },
      { id: 'f4' },
    ]);

    expect(types).toEqual(['Feature', 'Epic']);
  });

  it('reads configured state sequence from project display config', () => {
    const sequence = deriveConfiguredStateSequence([
      {
        id: 'p1',
        state_display_sequence: [{ types: ['New'] }, { types: ['Doing', 'Done'] }],
      },
      {
        id: 'p2',
        state_display_sequence: [{ types: ['Blocked', 'Done'] }],
      },
    ]);

    expect(sequence).toEqual(['New', 'Doing', 'Done', 'Blocked']);
  });

  it('orders available states by configured sequence and appends remaining states', () => {
    const ordered = deriveOrderedFeatureStateNames(
      [
        {
          id: 'p1',
          state_display_sequence: [{ types: ['New'] }, { types: ['Defined'] }, { types: ['Done'] }],
        },
      ],
      [
        { id: 'f1', state: 'Done' },
        { id: 'f2', state: 'New' },
        { id: 'f3', state: 'Blocked' },
        { id: 'f4', state: 'Defined' },
      ]
    );

    expect(ordered).toEqual(['New', 'Defined', 'Done', 'Blocked']);
  });
});
