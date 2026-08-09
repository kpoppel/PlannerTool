import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fixture, html } from '@open-wc/testing';

const mockSel = vi.hoisted(() => ({
  selection: {
    getEffectiveSelectedProjectIds: vi.fn(() => ['p1']),
    getSelectedTeamIds: vi.fn(() => ['t1']),
  },
  filter: {
    getSelectedFeatureStateSet: vi.fn(() => new Set(['Active'])),
  },
  view: {
    getCapacityViewMode: vi.fn(() => 'team'),
  },
}));

const mockState = vi.hoisted(() => ({
  teams: [{ id: 't1', selected: true }],
  projects: [{ id: 'p1', selected: true }],
  capacityDates: [],
  teamDailyCapacity: [],
  teamDailyCapacityMap: null,
  projectDailyCapacity: [],
  projectDailyCapacityMap: null,
  totalOrgDailyPerTeamAvg: [],
}));

const mockBus = vi.hoisted(() => ({
  on: vi.fn(() => () => {}),
  off: vi.fn(),
  emit: vi.fn(),
}));

const mockBoardCoords = vi.hoisted(() => ({
  subscribe: vi.fn(() => () => {}),
  scrollX: 0,
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {},
  sel: mockSel,
}));

vi.mock('../../www/js/services/State.js', () => ({
  state: mockState,
}));

vi.mock('../../www/js/core/EventBus.js', () => ({
  bus: mockBus,
}));

vi.mock('../../www/js/services/BoardCoordinateService.js', () => ({
  boardCoords: mockBoardCoords,
}));

import '../../www/js/components/MainGraph.lit.js';

describe('MainGraph Phase 4 selector seam', () => {
  const originalRaf = globalThis.requestAnimationFrame;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    mockSel.selection.getEffectiveSelectedProjectIds.mockClear();
    mockSel.selection.getSelectedTeamIds.mockClear();
    mockSel.filter.getSelectedFeatureStateSet.mockClear();
    mockSel.view.getCapacityViewMode.mockClear();
    mockBus.on.mockClear();
    mockBoardCoords.subscribe.mockClear();

    globalThis.requestAnimationFrame = (cb) => {
      cb();
      return 1;
    };

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect() {},
      fillRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      save() {},
      restore() {},
      setLineDash() {},
    }));
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('builds initial render snapshot via sel selectors', async () => {
    const el = await fixture(html`<maingraph-lit></maingraph-lit>`);
    await el.updateComplete;

    expect(mockSel.selection.getEffectiveSelectedProjectIds).toHaveBeenCalled();
    expect(mockSel.selection.getSelectedTeamIds).toHaveBeenCalled();
    expect(mockSel.view.getCapacityViewMode).toHaveBeenCalled();
    expect(mockSel.filter.getSelectedFeatureStateSet).toHaveBeenCalled();

    expect(mockBus.on).toHaveBeenCalled();
    expect(mockBoardCoords.subscribe).toHaveBeenCalled();
  });
});
