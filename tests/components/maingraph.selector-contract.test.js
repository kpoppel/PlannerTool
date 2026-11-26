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
    getProjects: vi.fn(() => [{ id: 'p1', selected: true, type: 'project',
      container_order: 0, container_types: ['project', 'team'] }]),
  },
  scope: {
    getContextTeams: vi.fn(() => ['t1']),
    getContextFeatures: vi.fn(() => [
      { project: 'p1' }, { project: 'program-1' },
    ]),
  },
  capacity: {
    getCapacityDates: vi.fn(() => []),
    getTeamDailyCapacity: vi.fn(() => []),
    getTeamDailyCapacityMap: vi.fn(() => null),
    getProjectDailyCapacity: vi.fn(() => []),
    getProjectDailyCapacityMap: vi.fn(() => null),
    getPlanDailyCapacityMap: vi.fn(() => []),
    getPlanTeamDailyCapacityMap: vi.fn(() => []),
    getTotalOrgDailyPerTeamAvg: vi.fn(() => []),
  },
  filter: {
    getSelectedFeatureStateSet: vi.fn(() => new Set(['Active'])),
  },
  view: {
    getEffectiveCapacityViewMode: vi.fn(() => 'team'),
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

describe('MainGraph selector seam', () => {
  const originalRaf = globalThis.requestAnimationFrame;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    mockSel.selection.getEffectiveSelectedProjectIds.mockClear();
    mockSel.selection.getSelectedTeamIds.mockClear();
    mockSel.scope.getContextTeams.mockClear();
    mockSel.filter.getSelectedFeatureStateSet.mockClear();
    mockSel.view.getEffectiveCapacityViewMode.mockClear();
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

    expect(mockSel.selection.getSelectedTeamIds).toHaveBeenCalled();
    expect(mockSel.selection.getEffectiveSelectedProjectIds).toHaveBeenCalled();
    expect(mockSel.scope.getContextFeatures).toHaveBeenCalled();
    expect(el._renderData.selectedProjectIds).toEqual(['p1', 'program-1']);
    expect(mockSel.view.getEffectiveCapacityViewMode).toHaveBeenCalled();
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

  it('plots only selected teams in Context without removing the selected plan', async () => {
    mockSel.selection.getSelectedTeamIds.mockReturnValueOnce(['t1', 'off-plan']);
    mockSel.scope.getContextTeams.mockReturnValueOnce(['t1', 'unselected']);
    const scoped = await fixture(html`<maingraph-lit></maingraph-lit>`);
    await scoped.updateComplete;
    expect(scoped._renderData.selectedTeamIds).toEqual(['t1']);

    mockSel.scope.getContextFeatures.mockReturnValueOnce([]);
    mockSel.scope.getContextTeams.mockReturnValueOnce([]);
    const el = await fixture(html`<maingraph-lit></maingraph-lit>`);
    await el.updateComplete;
    expect(el._renderData.selectedTeamIds).toEqual([]);
    expect(el._renderData.selectedProjectIds).toEqual(['p1']);
  });

  it('renders team reservations under a higher-level plan without a loaded lowest container', async () => {
    const el = await fixture(html`<maingraph-lit></maingraph-lit>`);
    const context = HTMLCanvasElement.prototype.getContext.mock.results[0].value;
    context.fillRect = vi.fn();
    context.stroke = vi.fn();
    el._canvasRef = { width: 60, height: 120 };
    el._fullRender(context, {
      months: [new Date('2026-01-01T00:00:00Z')],
      teams: [{ id: 't1', name: 'Delivery', color: '#112233' }, { id: 't2' }],
      projects: [
        { id: 'root', type: 'portfolio', container_order: 0,
          container_types: ['portfolio', 'program', 'squad'] },
      ],
      capacityDates: ['2026-01-01'],
      teamDailyCapacityMap: [{ t1: 80 }],
      planDailyCapacityMap: [{ root: 80 }],
      planTeamDailyCapacityMap: [{ root: { t1: 80 } }],
      capacityViewMode: 'squad',
      selectedTeamIds: new Set(['t1']),
      selectedProjectIds: new Set(['root']),
    });
    expect(el._hoverDays[0].entries).toEqual([
      { name: 'Delivery', color: '#112233', value: 80 },
    ]);
    expect(context.fillRect).not.toHaveBeenCalled();
    expect(context.stroke).toHaveBeenCalled();
  });

  it('uses canonical team demand across selected plans without adding plan totals twice', async () => {
    const el = await fixture(html`<maingraph-lit></maingraph-lit>`);
    const context = HTMLCanvasElement.prototype.getContext.mock.results[0].value;
    el._canvasRef = { width: 60, height: 120 };
    for (const selectedPlans of [['own'], ['peer'], ['own', 'peer', 'program']]) {
      el._hoverDays = [];
      el._fullRender(context, {
        months: [new Date('2026-01-01T00:00:00Z')],
        teams: [
          { id: 'A', name: 'Delivery', color: '#112233' },
          { id: 'B', name: 'Other team' },
          { id: 'G', name: 'Group', color: '#445566' },
          { id: 'idle', name: 'Idle', color: '#778899' },
        ],
        projects: [
          { id: 'own', type: 'squad', container_order: 2, container_types: ['portfolio', 'program', 'squad'] },
          { id: 'peer', type: 'squad', container_order: 2, container_types: ['portfolio', 'program', 'squad'] },
          { id: 'program', type: 'program', container_order: 1,
            container_types: ['portfolio', 'program', 'squad'] },
        ],
        capacityDates: ['2026-01-01'],
        teamDailyCapacityMap: [{ A: 90, B: 40, G: 65 }],
        planDailyCapacityMap: [{ own: 20, peer: 30, program: 80 }],
        planTeamDailyCapacityMap: [{ own: { A: 20 }, peer: { A: 30 }, program: { A: 40, B: 40 } }],
        capacityViewMode: 'squad',
        selectedTeamIds: new Set(['A', 'G', 'idle']),
        selectedProjectIds: new Set(selectedPlans),
      });
      expect(el._hoverDays[0].entries).toEqual([
        { name: 'Delivery', color: '#112233', value: 90 },
        { name: 'Group', color: '#445566', value: 65 },
        { name: 'Idle', color: '#778899', value: 0 },
      ]);
    }
  });

  it('renders intermediate containers as organisationally weighted stacked bars', async () => {
    const el = await fixture(html`<maingraph-lit></maingraph-lit>`);
    const context = HTMLCanvasElement.prototype.getContext.mock.results[0].value;
    context.fillRect = vi.fn();
    el._canvasRef = { width: 60, height: 120 };
    el._fullRender(context, {
      months: [new Date('2026-01-01T00:00:00Z')],
      teams: [{ id: 't1' }, { id: 't2' }],
      projects: [
        { id: 'middle', name: 'Program', color: '#123456', type: 'program', container_order: 1, container_types: ['portfolio', 'program', 'squad'] },
      ],
      capacityDates: ['2026-01-01'],
      planDailyCapacityMap: [{ middle: 80 }],
      planTeamDailyCapacityMap: [{}],
      capacityViewMode: 'program',
      selectedTeamIds: new Set(),
      selectedProjectIds: new Set(['middle']),
    });
    expect(el._hoverDays[0].entries).toEqual([
      { name: 'Program', color: '#123456', value: 40 },
    ]);
    expect(context.fillRect).toHaveBeenCalled();
  });
});
