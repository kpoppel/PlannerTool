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
    expect(svc.getAvailableStates()).toEqual(['New', 'Active', 'Resolved', 'Closed']);
  });

  it('deduplicates states across projects preserving first-encounter order', () => {
    svc.loadFromProjects([
      { display_states: ['New', 'Active', 'Closed'] },
      { display_states: ['Active', 'Resolved', 'Closed', 'New'] },
    ]);
    expect(svc.getAvailableStates()).toEqual(['New', 'Active', 'Closed', 'Resolved']);
  });

  it('skips projects with no display_states field', () => {
    svc.loadFromProjects([
      { name: 'NoStates' },
      { display_states: ['Open', 'Done'] },
    ]);
    expect(svc.getAvailableStates()).toEqual(['Open', 'Done']);
  });

  it('skips projects where display_states is not an array', () => {
    svc.loadFromProjects([
      { display_states: 'Active' },
      { display_states: ['New', 'Done'] },
    ]);
    expect(svc.getAvailableStates()).toEqual(['New', 'Done']);
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
    expect(svc.getAvailableStates()).toEqual(['New', 'Active']);
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
