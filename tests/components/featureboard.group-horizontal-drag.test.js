import { describe, expect, it, vi } from 'vitest';

const { mockCmd, mockSel } = vi.hoisted(() => ({
  mockCmd: {
    feature: { updateFeatureDates: vi.fn() },
    group: { moveGroupInScenario: vi.fn() },
  },
  mockSel: {
    group: { getEffectiveGroups: vi.fn(() => []) },
    feature: { getEffectiveFeatures: vi.fn(() => []) },
  },
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: mockCmd,
  sel: mockSel,
}));

import '../../www/js/components/FeatureBoard.lit.js';

describe('FeatureBoard horizontal group drag', () => {
  it('shifts planned group members and descendants, leaves unplanned untouched', async () => {
    await customElements.whenDefined('feature-board');
    const board = document.createElement('feature-board');

    board._fullRenderList = [
      { isGroup: true, id: 'g1', left: 120 },
    ];

    mockSel.group.getEffectiveGroups.mockReturnValue([
      { id: 'g1', plan_id: 'p1', members: ['f1', 'f2'] },
    ]);

    mockSel.feature.getEffectiveFeatures.mockReturnValue([
      { id: 'f1', start: '2025-01-10', end: '2025-01-20', parentId: null, relations: [] },
      { id: 'f1c', start: '2025-01-12', end: '2025-01-18', parentId: 'f1', relations: [] },
      { id: 'f2', start: null, end: null, parentId: null, relations: [] },
    ]);

    board._dateFromLeftPx = vi
      .fn()
      .mockReturnValueOnce(new Date('2025-01-10T00:00:00Z'))
      .mockReturnValueOnce(new Date('2025-01-12T00:00:00Z'));

    board._shiftGroupContentsByDeltaX({ id: 'g1', plan_id: 'p1' }, 40);

    expect(mockCmd.feature.updateFeatureDates).toHaveBeenCalledOnce();
    const updates = mockCmd.feature.updateFeatureDates.mock.calls[0][0];
    const ids = updates.map((u) => u.id).sort();
    expect(ids).toEqual(['f1', 'f1c']);
    expect(updates.find((u) => u.id === 'f1').start).toBe('2025-01-12');
    expect(updates.find((u) => u.id === 'f1').end).toBe('2025-01-22');
  });
});
