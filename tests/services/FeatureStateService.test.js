import { describe, expect, it } from 'vitest';
import { FeatureStateService } from '../../www/js/services/FeatureStateService.js';

describe('FeatureStateService', () => {
  it('loads states in configured display order and resolves categories', () => {
    const service = new FeatureStateService();

    service.loadFromProjects([
      {
        display_states: ['Closed', 'New', 'Doing'],
        state_categories: {
          New: 'Proposed',
          Doing: 'InProgress',
          Closed: 'Completed',
        },
        state_display_sequence: [
          { types: ['New'] },
          { types: ['Doing'] },
          { types: ['Closed'] },
        ],
      },
    ]);

    expect(service.getAvailableStates()).toEqual(['New', 'Doing', 'Closed']);
    expect(service.getCategoryForState('doing')).toBe('InProgress');
    expect(service.isStateInCategory('Closed', 'Completed')).toBe(true);
  });

  it('falls back to category precedence when no configured sequence exists', () => {
    const service = new FeatureStateService();

    service.loadFromProjects([
      {
        display_states: ['Closed', 'Todo', 'Doing', 'Resolved'],
        state_categories: {
          Todo: 'Proposed',
          Doing: 'InProgress',
          Resolved: 'Resolved',
          Closed: 'Completed',
        },
      },
    ]);

    expect(service.getAvailableStates()).toEqual(['Todo', 'Doing', 'Resolved', 'Closed']);
    expect(service.compareStates('Closed', 'Todo')).toBeGreaterThan(0);
  });

  it('keeps unassigned last and compares states using the current ordering', () => {
    const service = new FeatureStateService();

    service.loadFromProjects([
      {
        display_states: ['New', 'Resolved', 'Unassigned', 'Doing'],
        state_categories: {
          New: 'Proposed',
          Doing: 'InProgress',
          Resolved: 'Resolved',
        },
      },
    ]);

    expect(service.compareStates('Doing', 'New')).toBeGreaterThan(0);
    expect(service.compareStates('Unassigned', 'Doing')).toBeGreaterThan(0);
    expect(service.compareStates('Doing', 'Unassigned')).toBeLessThan(0);
  });
});
