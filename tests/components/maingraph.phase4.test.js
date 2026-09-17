import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fixture, html } from '@open-wc/testing';
import {
  FeatureEvents,
  StateFilterEvents,
  TimelineEvents,
  ViewEvents,
} from '../../www/js/core/EventRegistry.js';

const mockSel = vi.hoisted(() => ({
  selection: {
    getEffectiveSelectedProjectIds: vi.fn(() => ['p1']),
    getSelectedTeamIds: vi.fn(() => ['t1']),
    getTeams: vi.fn(() => [{ id: 't1', selected: true }]),
    getProjects: vi.fn(() => [{ id: 'p1', selected: true }]),
  },
  scope: {
    getContextTeams: vi.fn(() => ['t1']),
  },
  capacity: {
    getCapacityDates: vi.fn(() => []),
    getTeamDailyCapacity: vi.fn(() => []),
    getTeamDailyCapacityMap: vi.fn(() => null),
    getProjectDailyCapacity: vi.fn(() => []),
    getProjectDailyCapacityMap: vi.fn(() => null),
    getTotalOrgDailyPerTeamAvg: vi.fn(() => []),
  },
  filter: {
    getSelectedFeatureStateSet: vi.fn(() => new Set(['Active'])),
  },
  view: {
    getCapacityViewMode: vi.fn(() => 'team'),
  },
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
    mockSel.scope.getContextTeams.mockClear();
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
    expect(mockSel.scope.getContextTeams).toHaveBeenCalled();
    expect(mockSel.view.getCapacityViewMode).toHaveBeenCalled();
    expect(mockSel.filter.getSelectedFeatureStateSet).toHaveBeenCalled();

    expect(mockBus.on).toHaveBeenCalled();
    expect(mockBoardCoords.subscribe).toHaveBeenCalled();
  });

  it('refreshes when feature mutations, state filters, or view toggles change', async () => {
    const el = await fixture(html`<maingraph-lit></maingraph-lit>`);
    await el.updateComplete;

    const subscribedEvents = mockBus.on.mock.calls.map(([event]) => event);
    expect(subscribedEvents).toContain(FeatureEvents.UPDATED);
    expect(subscribedEvents).toContain(StateFilterEvents.CHANGED);
    expect(subscribedEvents).toContain(ViewEvents.CAPACITY_MODE);
    expect(subscribedEvents).toContain(ViewEvents.CONDENSED);
    expect(subscribedEvents).toContain(ViewEvents.DEPENDENCIES);
    expect(subscribedEvents).toContain(ViewEvents.SORT_MODE);
    expect(subscribedEvents).toContain(ViewEvents.DISPLAY_MODE);
    expect(subscribedEvents).toContain(TimelineEvents.SCALE_CHANGED);
  });
});
