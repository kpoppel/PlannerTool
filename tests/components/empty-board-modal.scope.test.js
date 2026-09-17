import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockVisibleFeatures } = vi.hoisted(() => ({
  mockVisibleFeatures: vi.fn(() => [{ id: 'feature-1' }]),
}));

vi.mock('../../www/js/application/imports.js', () => ({
  sel: {
    selection: {
      getSelectedProjectIds: () => [],
      getSelectedTeamIds: () => ['team-1'],
      getTeams: () => [{ id: 'team-1' }],
    },
    filter: {
      getSelectedFeatureStateSet: () => new Set(['active']),
      getTaskFilters: () => ({
        schedule: { planned: true, unplanned: true },
      }),
    },
    feature: {
      getAvailableTaskTypes: () => ['feature'],
    },
    scope: {
      getVisibleFeatures: mockVisibleFeatures,
    },
    view: {
      isTypeVisible: () => true,
      getShowUnplannedWork: () => true,
      getShowOnlyProjectHierarchy: () => false,
    },
  },
}));

import { EmptyBoardModal } from '../../www/js/components/EmptyBoardModal.lit.js';

describe('EmptyBoardModal canonical scope', () => {
  beforeEach(() => {
    mockVisibleFeatures.mockClear();
  });

  it('uses canonical visible scope instead of legacy expansion IDs', () => {
    const modal = new EmptyBoardModal();

    expect(modal._hasVisibleFeatures()).toBe(true);
    expect(mockVisibleFeatures).toHaveBeenCalledOnce();
  });

  it('does not recommend obsolete Team Allocated expansion', () => {
    const modal = new EmptyBoardModal();
    const reasons = modal._computeReasons().join(' ');

    expect(reasons).not.toContain('Team Allocated');
    expect(reasons).not.toContain('expansion');
  });
});