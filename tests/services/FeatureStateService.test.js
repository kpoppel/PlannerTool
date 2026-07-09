import { describe, it, expect, beforeEach } from 'vitest';
import { FeatureStateService } from '../../www/js/services/FeatureStateService.js';

describe('FeatureStateService', () => {
  let svc;

  beforeEach(() => {
    svc = new FeatureStateService();
  });

  // ── loadFromProjects ─────────────────────────────────────────────────────

  it('returns empty state list when no projects are loaded', () => {
    expect(svc.getAvailableStates()).toEqual([]);
  });

  it('collects display_states from a single project in order', () => {
    svc.loadFromProjects([
      { display_states: ['New', 'Active', 'Resolved', 'Closed'] },
    ]);
    // No configured sequence and no categories => alphabetical fallback.
    expect(svc.getAvailableStates()).toEqual(['Active', 'Closed', 'New', 'Resolved']);
  });

  it('deduplicates states across projects', () => {
    svc.loadFromProjects([
      { display_states: ['New', 'Active', 'Closed'] },
      { display_states: ['Active', 'Resolved', 'Closed', 'New'] },
    ]);
    expect(svc.getAvailableStates()).toEqual(['Active', 'Closed', 'New', 'Resolved']);
  });

  it('skips projects with no display_states field', () => {
    svc.loadFromProjects([
      { name: 'NoStates' },
      { display_states: ['Open', 'Done'] },
    ]);
    expect(svc.getAvailableStates()).toEqual(['Done', 'Open']);
  });

  it('skips projects where display_states is not an array', () => {
    svc.loadFromProjects([
      { display_states: 'Active' },
      { display_states: ['New', 'Done'] },
    ]);
    expect(svc.getAvailableStates()).toEqual(['Done', 'New']);
  });

  it('returns a cloned array so internal state cannot be mutated', () => {
    svc.loadFromProjects([{ display_states: ['New'] }]);
    const first = svc.getAvailableStates();
    first.push('Injected');
    expect(svc.getAvailableStates()).toEqual(['New']);
  });

  it('replaces state data when loadFromProjects is called again', () => {
    svc.loadFromProjects([{ display_states: ['Old'] }]);
    svc.loadFromProjects([{ display_states: ['New', 'Active'] }]);
    expect(svc.getAvailableStates()).toEqual(['Active', 'New']);
  });

  // ── getCategoryForState ──────────────────────────────────────────────────

  it('returns null for a state with no category mapping', () => {
    svc.loadFromProjects([{ display_states: ['New'] }]);
    expect(svc.getCategoryForState('New')).toBeNull();
  });

  it('returns the correct category for a mapped state', () => {
    svc.loadFromProjects([
      {
        display_states: ['New', 'Active', 'Closed'],
        state_categories: { New: 'Proposed', Active: 'InProgress', Closed: 'Completed' },
      },
    ]);
    expect(svc.getCategoryForState('New')).toBe('Proposed');
    expect(svc.getCategoryForState('Active')).toBe('InProgress');
    expect(svc.getCategoryForState('Closed')).toBe('Completed');
    expect(svc.getCategoryForState('closed')).toBe('Completed');
  });

  it('first project definition wins for duplicate category mappings', () => {
    svc.loadFromProjects([
      { display_states: ['Active'], state_categories: { Active: 'InProgress' } },
      { display_states: ['Active'], state_categories: { Active: 'Completed' } },
    ]);
    expect(svc.getCategoryForState('Active')).toBe('InProgress');
  });

  it('returns null for an unknown state name', () => {
    svc.loadFromProjects([
      { display_states: ['Active'], state_categories: { Active: 'InProgress' } },
    ]);
    expect(svc.getCategoryForState('NonExistent')).toBeNull();
  });

  // ── getStateCategories ───────────────────────────────────────────────────

  it('returns empty object when no categories are loaded', () => {
    expect(svc.getStateCategories()).toEqual({});
  });

  it('returns plain object snapshot of all category mappings', () => {
    svc.loadFromProjects([
      {
        display_states: ['New', 'Active'],
        state_categories: { New: 'Proposed', Active: 'InProgress' },
      },
    ]);
    expect(svc.getStateCategories()).toEqual({ New: 'Proposed', Active: 'InProgress' });
  });

  // ── isStateInCategory ────────────────────────────────────────────────────

  it('returns true when state matches the queried category', () => {
    svc.loadFromProjects([
      { display_states: ['Closed'], state_categories: { Closed: 'Completed' } },
    ]);
    expect(svc.isStateInCategory('Closed', 'Completed')).toBe(true);
  });

  it('returns false when state does not match the queried category', () => {
    svc.loadFromProjects([
      { display_states: ['Closed'], state_categories: { Closed: 'Completed' } },
    ]);
    expect(svc.isStateInCategory('Closed', 'Proposed')).toBe(false);
  });

  it('returns false for unknown state', () => {
    svc.loadFromProjects([]);
    expect(svc.isStateInCategory('Ghost', 'InProgress')).toBe(false);
  });

  // ── configured sequence ordering ─────────────────────────────────────────

  it('applies configured state_display_sequence first when present', () => {
    svc.loadFromProjects([
      {
        display_states: ['New', 'Active', 'Resolved', 'Closed'],
        state_display_sequence: [
          { types: ['New'] },
          { types: ['Active'] },
          { types: ['Resolved'] },
          { types: ['Closed'] },
        ],
      },
    ]);
    expect(svc.getAvailableStates()).toEqual(['New', 'Active', 'Resolved', 'Closed']);
  });

  it('appends states missing from configured sequence after configured states', () => {
    svc.loadFromProjects([
      {
        display_states: ['New', 'Active', 'Blocked', 'Closed'],
        state_display_sequence: [
          { types: ['New'] },
          { types: ['Active'] },
          { types: ['Closed'] },
        ],
      },
    ]);
    expect(svc.getAvailableStates()).toEqual(['New', 'Active', 'Closed', 'Blocked']);
  });

  it('applies configured sequence from admin level-object format', () => {
    svc.loadFromProjects([
      {
        display_states: ['New', 'Active', 'Defined', 'Resolved', 'Closed'],
        state_display_sequence: [
          { types: ['New'] },
          { types: ['Defined'] },
          { types: ['Active'] },
          { types: ['Resolved'] },
          { types: ['Closed'] },
        ],
      },
    ]);
    expect(svc.getAvailableStates()).toEqual([
      'New',
      'Defined',
      'Active',
      'Resolved',
      'Closed',
    ]);
  });

  it('getConfiguredSequence returns flattened order from level-object format', () => {
    svc.loadFromProjects([
      {
        display_states: ['New', 'Defined', 'Active'],
        state_display_sequence: [
          { types: ['New', 'Defined'] },
          { types: ['Active'] },
        ],
      },
    ]);
    expect(svc.getConfiguredSequence()).toEqual(['New', 'Defined', 'Active']);
  });

  it('uses category precedence then name when no configured sequence exists', () => {
    svc.loadFromProjects([
      {
        display_states: ['Closed', 'Resolved', 'Active', 'New', 'RemovedState'],
        state_categories: {
          Closed: 'Completed',
          Resolved: 'Resolved',
          Active: 'InProgress',
          New: 'Proposed',
          RemovedState: 'Removed',
        },
      },
    ]);
    expect(svc.getAvailableStates()).toEqual([
      'New',
      'Active',
      'Resolved',
      'Closed',
      'RemovedState',
    ]);
  });

  it('returns configured sequence snapshot', () => {
    svc.loadFromProjects([
      {
        display_states: ['New', 'Active'],
        state_display_sequence: [
          { types: ['New'] },
          { types: ['Active'] },
        ],
      },
    ]);
    expect(svc.getConfiguredSequence()).toEqual(['New', 'Active']);
  });

  // ── compareStates ────────────────────────────────────────────────────────

  it('compareStates follows configured order', () => {
    svc.loadFromProjects([
      {
        display_states: ['New', 'Active', 'Closed'],
        state_display_sequence: [
          { types: ['New'] },
          { types: ['Active'] },
          { types: ['Closed'] },
        ],
      },
    ]);
    expect(svc.compareStates('New', 'Active')).toBeLessThan(0);
    expect(svc.compareStates('Closed', 'Active')).toBeGreaterThan(0);
  });

  it('compareStates puts unknown states after known states', () => {
    svc.loadFromProjects([
      {
        display_states: ['New', 'Active'],
        state_display_sequence: [
          { types: ['New'] },
          { types: ['Active'] },
        ],
      },
    ]);
    expect(svc.compareStates('New', 'Custom')).toBeLessThan(0);
    expect(svc.compareStates('Custom', 'Active')).toBeGreaterThan(0);
  });

  it('compareStates always puts Unassigned last', () => {
    svc.loadFromProjects([
      {
        display_states: ['New', 'Active'],
        state_display_sequence: [
          { types: ['New'] },
          { types: ['Active'] },
        ],
      },
    ]);
    expect(svc.compareStates('Unassigned', 'New')).toBeGreaterThan(0);
    expect(svc.compareStates('Active', 'Unassigned')).toBeLessThan(0);
  });

  it('ignores legacy flat-array sequence format', () => {
    svc.loadFromProjects([
      {
        display_states: ['New', 'Defined', 'Active', 'Resolved', 'Closed'],
        state_categories: {
          New: 'Proposed',
          Defined: 'InProgress',
          Active: 'InProgress',
          Resolved: 'Resolved',
          Closed: 'Completed',
        },
        state_display_sequence: ['New', 'Defined', 'Active', 'Resolved', 'Closed'],
      },
    ]);

    // Falls back to category + name ordering because legacy flat format is ignored.
    expect(svc.getAvailableStates()).toEqual([
      'New',
      'Active',
      'Defined',
      'Resolved',
      'Closed',
    ]);
    expect(svc.getConfiguredSequence()).toEqual([]);
  });

  // ── integration: state_categories filtered to display_states only ────────

  it('handles state_categories entries not in display_states gracefully', () => {
    // The backend only sends categories for display_states, but the JS service
    // should be tolerant if extra entries arrive.
    svc.loadFromProjects([
      {
        display_states: ['New'],
        state_categories: { New: 'Proposed', Hidden: 'InProgress' },
      },
    ]);
    // getCategoryForState still works for loaded categories even if not in display_states
    expect(svc.getCategoryForState('New')).toBe('Proposed');
    expect(svc.getCategoryForState('Hidden')).toBe('InProgress');
    // But available states only contains what was in display_states
    expect(svc.getAvailableStates()).toEqual(['New']);
  });
});
