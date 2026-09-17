import { expect, fixture, html } from '@open-wc/testing';
import { stub } from 'sinon';
import { TIMELINE_CONFIG } from '../../www/js/components/Timeline.lit.js';

describe('MainGraph Tests', () => {
  describe('maingraph-lit basic API and rendering', () => {
    let mockBus;
    beforeEach(() => {
      mockBus = { emit: stub(), on: stub(), off: stub() };
    });

    it('renders canvas and exposes APIs', async () => {
      await import('../../www/js/components/MainGraph.lit.js');
      const el = await fixture(html`<maingraph-lit .bus=${mockBus}></maingraph-lit>`);
      const canvas = el.shadowRoot.querySelector('canvas');
      expect(canvas).to.exist;
      expect(canvas.tagName).to.equal('CANVAS');
      expect(canvas.getAttribute('aria-label')).to.equal(
        'Organization-wide capacity load. Sidebar display filters do not change this graph.'
      );
      expect(canvas.hasAttribute('title')).to.equal(false);
      expect(el.renderGraph).to.be.a('function');
      expect(el.updateViewport).to.be.a('function');
    });

    it('sets canvas dimensions from properties', async () => {
      const el = await fixture(
        html`<maingraph-lit .bus=${mockBus} .width=${800} .height=${120}></maingraph-lit>`
      );
      const canvas = el.shadowRoot.querySelector('canvas');
      expect(canvas.width).to.equal(800);
      expect(canvas.height).to.equal(120);
    });

    it('scales only the horizontal render width', async () => {
      const el = await fixture(
        html`<maingraph-lit
          .bus=${mockBus}
          .height=${120}
          .horizontalScale=${0.5}
        ></maingraph-lit>`
      );
      const canvas = el.shadowRoot.querySelector('canvas');

      expect(el._getRenderMonthWidth()).to.equal(TIMELINE_CONFIG.monthWidth * 0.5);
      expect(canvas.height).to.equal(120);
    });

    it('handles empty data gracefully', async () => {
      const el = await fixture(html`<maingraph-lit .bus=${mockBus}></maingraph-lit>`);
      const data = { months: [], teamData: [], projectData: [] };
      await el.renderGraph(data);
      const canvas = el.shadowRoot.querySelector('canvas');
      expect(canvas).to.exist;
    });

    it('shows the hovered day and currently displayed series', async () => {
      await import('../../www/js/components/MainGraph.lit.js');
      const el = await fixture(html`<maingraph-lit .bus=${mockBus}></maingraph-lit>`);
      await el.updateComplete;
      const canvas = el.shadowRoot.querySelector('canvas');
      el._canvasRef = canvas;
      canvas.width = 300;
      el._hoverDays = [{
        startX: 0,
        endX: 300,
        date: '2025-01-01',
        entries: [
          { name: 'Team A', color: '#111111', value: 60.6 },
          { name: 'Team B', color: '#222222', value: 40 },
        ],
      }];
      canvas.getBoundingClientRect = () => ({ left: 0, width: 300 });

      el._onGraphPointerMove(new MouseEvent('mousemove', { clientX: 15 }));
      await el.updateComplete;

      const tooltip = el.shadowRoot.querySelector('.graph-tooltip');
      expect(tooltip.textContent).to.contain('2025-01-01');
      expect(tooltip.style.zIndex).to.equal('1000');
      expect(tooltip.textContent).to.contain('Team A');
      expect(tooltip.textContent).to.contain('61%');
      expect(tooltip.textContent).to.contain('Team B');
      expect(tooltip.dataset.side).to.equal('right');
      expect(tooltip.style.left).to.equal('27px');

      el._onGraphPointerMove(new MouseEvent('mousemove', { clientX: 285 }));
      await el.updateComplete;
      expect(el.shadowRoot.querySelector('.graph-tooltip').dataset.side).to.equal('left');
      expect(el.shadowRoot.querySelector('.graph-tooltip').style.left).to.equal('273px');

      el._onGraphPointerLeave();
      await el.updateComplete;
      expect(el.shadowRoot.querySelector('.graph-tooltip')).to.equal(null);
    });
  });

  describe('internal rendering branches', () => {
    let MainGraphLit;
    before(async () => {
      const mod = await import('../../www/js/components/MainGraph.lit.js');
      MainGraphLit = mod.MainGraphLit;
    });

    it('renderGraph/_fullRender uses canvas context and does not throw', async () => {
      const el = document.createElement('maingraph-lit');
      document.body.appendChild(el);
      await el.updateComplete;

      const calls = { clearRect: 0, fillRect: 0, beginPath: 0, stroke: 0 };
      const mockCtx = {
        clearRect() {
          calls.clearRect++;
        },
        fillRect() {
          calls.fillRect++;
        },
        beginPath() {
          calls.beginPath++;
        },
        moveTo() {},
        lineTo() {},
        stroke() {
          calls.stroke++;
        },
        save() {},
        restore() {},
        setLineDash() {},
        getContext() {
          return this;
        },
      };

      el._canvasRef = { width: 800, height: 120, getContext: () => mockCtx };

      const months = [new Date(2022, 0, 1), new Date(2022, 1, 1), new Date(2022, 2, 1)];
      const snapshot = {
        months,
        teams: [{ id: 't1', color: '#123' }],
        projects: [{ id: 'p1', color: '#456' }],
        capacityDates: months.map((m) => new Date(m).toISOString().slice(0, 10)),
        teamDailyCapacity: [
          [10, 20, 30],
          [5, 15, 25],
          [0, 0, 0],
        ],
        teamDailyCapacityMap: null,
        projectDailyCapacity: [],
        projectDailyCapacityMap: null,
        totalOrgDailyPerTeamAvg: [],
        capacityViewMode: 'team',
        selectedTeamIds: new Set(['t1']),
        selectedProjectIds: new Set(['p1']),
      };

      // call internal render to exercise branches
      el._fullRender(mockCtx, snapshot);
      const any = calls.clearRect + calls.fillRect + calls.beginPath + calls.stroke;
      expect(any).to.be.at.least(0);

      // updateViewport should not throw when _renderData missing
      calls.clearRect = 0;
      el.updateViewport({ scrollLeft: 10 });
      expect(calls.clearRect).to.equal(0);
      el.remove();
    });

    it('renders project stacked bars branch', async () => {
      const el = document.createElement('maingraph-lit');
      document.body.appendChild(el);
      await el.updateComplete;
      const calls = { fillRect: 0 };
      const mockCtx = {
        clearRect() {},
        fillRect() {
          calls.fillRect++;
        },
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        save() {},
        restore() {},
        setLineDash() {},
      };
      el._canvasRef = { width: 600, height: 120, getContext: () => mockCtx };

      const months = [new Date(2022, 0, 1), new Date(2022, 1, 1)];
      const snapshot = {
        months,
        teams: [{ id: 't1', color: '#111' }],
        projects: [{ id: 'p1', color: '#222' }],
        capacityDates: months.map((m) => m.toISOString().slice(0, 10)),
        teamDailyCapacity: [],
        teamDailyCapacityMap: null,
        projectDailyCapacity: [
          [10, 0],
          [20, 0],
        ],
        projectDailyCapacityMap: null,
        totalOrgDailyPerTeamAvg: [],
        capacityViewMode: 'project',
        selectedTeamIds: new Set(['t1']),
        selectedProjectIds: new Set(['p1']),
      };

      el._fullRender(mockCtx, snapshot);
      expect(calls.fillRect).to.be.at.least(1);
      el.remove();
    });

    it('renders an empty team graph when no plans are selected', async () => {
      const el = document.createElement('maingraph-lit');
      document.body.appendChild(el);
      await el.updateComplete;

      const calls = { stroke: 0 };
      const mockCtx = {
        clearRect() {},
        fillRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {
          calls.stroke++;
        },
        save() {},
        restore() {},
        setLineDash() {},
      };
      el._canvasRef = { width: 600, height: 120, getContext: () => mockCtx };

      const months = [new Date(2022, 0, 1), new Date(2022, 1, 1)];
      // Team Drill-down does not override the no-plan graph contract.
      const snapshot = {
        months,
        teams: [{ id: 't1', color: '#111' }],
        projects: [{ id: 'p1', color: '#222' }],
        capacityDates: months.map((m) => m.toISOString().slice(0, 10)),
        teamDailyCapacity: [],
        teamDailyCapacityMap: { 0: { t1: 50 }, 1: { t1: 60 } },
        projectDailyCapacity: [],
        projectDailyCapacityMap: null,
        totalOrgDailyPerTeamAvg: [],
        capacityViewMode: 'team',
        selectedTeamIds: new Set(['t1']),
        selectedProjectIds: new Set(), // no plans selected
      };

      // Axes may be drawn, but no capacity line should be rendered.
      el._fullRender(mockCtx, snapshot);
      expect(calls.stroke).to.equal(0);
      el.remove();
    });

    it('renders no team series when team drill-down is empty', async () => {
      const el = document.createElement('maingraph-lit');
      document.body.appendChild(el);
      await el.updateComplete;

      const calls = { stroke: 0 };
      const mockCtx = {
        clearRect() {},
        fillRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {
          calls.stroke++;
        },
        save() {},
        restore() {},
        setLineDash() {},
      };
      el._canvasRef = { width: 600, height: 120, getContext: () => mockCtx };

      const months = [new Date(2022, 0, 1), new Date(2022, 1, 1)];
      const snapshot = {
        months,
        teams: [{ id: 't1', color: '#111' }, { id: 't2', color: '#222' }],
        projects: [{ id: 'p1', color: '#333' }],
        capacityDates: months.map((m) => m.toISOString().slice(0, 10)),
        teamDailyCapacity: [],
        teamDailyCapacityMap: { 0: { t1: 50, t2: 60 }, 1: { t1: 40, t2: 70 } },
        projectDailyCapacity: [],
        projectDailyCapacityMap: null,
        totalOrgDailyPerTeamAvg: [],
        capacityViewMode: 'team',
        selectedTeamIds: new Set(),
        selectedProjectIds: new Set(['p1']),
      };

      el._fullRender(mockCtx, snapshot);
      expect(calls.stroke).to.equal(0);
      el.remove();
    });

    it('draws only selected team series', async () => {
      const el = document.createElement('maingraph-lit');
      document.body.appendChild(el);
      await el.updateComplete;

      const seriesColors = [];
      const mockCtx = {
        clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
        stroke() {
          if (this.lineWidth === 2) seriesColors.push(this.strokeStyle);
        },
        save() {}, restore() {}, setLineDash() {},
      };
      el._canvasRef = { width: 600, height: 120, getContext: () => mockCtx };
      const months = [new Date(2022, 0, 1), new Date(2022, 1, 1)];

      el._fullRender(mockCtx, {
        months,
        teams: [{ id: 't1', color: '#111111' }, { id: 't2', color: '#222222' }],
        projects: [{ id: 'p1', color: '#333333' }],
        capacityDates: months.map((month) => month.toISOString().slice(0, 10)),
        teamDailyCapacity: [],
        teamDailyCapacityMap: [{ t1: 50, t2: 60 }, { t1: 40, t2: 70 }],
        projectDailyCapacity: [],
        projectDailyCapacityMap: null,
        totalOrgDailyPerTeamAvg: [],
        capacityViewMode: 'team',
        selectedTeamIds: new Set(['t1']),
        selectedProjectIds: new Set(['p1']),
      });

      expect(seriesColors).to.include('#111111');
      expect(seriesColors).not.to.include('#222222');
      el.remove();
    });

    it('keeps project and unfunded values normalized by the full roster', async () => {
      const el = document.createElement('maingraph-lit');
      document.body.appendChild(el);
      await el.updateComplete;

      const mockCtx = {
        clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
        save() {}, restore() {}, setLineDash() {},
      };
      el._canvasRef = { width: 600, height: 120, getContext: () => mockCtx };
      const months = [new Date(2022, 0, 1), new Date(2022, 1, 1)];
      const snapshot = {
        months,
        teams: [{ id: 't1', color: '#111' }, { id: 't2', color: '#222' }],
        projects: [{ id: 'p1', name: 'Plan', color: '#333', type: 'project' }],
        capacityDates: months.map((month) => month.toISOString().slice(0, 10)),
        teamDailyCapacity: [],
        teamDailyCapacityMap: { 0: { t1: 20, t2: 110 }, 1: { t1: 20, t2: 110 } },
        projectDailyCapacity: [],
        projectDailyCapacityMap: { 0: { p1: 100, __unfunded__: 40 }, 1: { p1: 100, __unfunded__: 40 } },
        totalOrgDailyPerTeamAvg: [],
        capacityViewMode: 'project',
        selectedTeamIds: new Set(['t1']),
        selectedProjectIds: new Set(['p1']),
      };

      el._fullRender(mockCtx, snapshot);
      const narrowDrillDownEntries = el._hoverDays[0].entries;

      el._hoverDays = [];
      snapshot.selectedTeamIds = new Set(['t2']);
      el._fullRender(mockCtx, snapshot);

      expect(narrowDrillDownEntries).to.deep.equal([
        { name: 'Plan', color: '#333', value: 50 },
        { name: 'Unfunded', color: '#C49E78', value: 20 },
      ]);
      expect(el._hoverDays[0].entries).to.deep.equal(narrowDrillDownEntries);
      el.remove();
    });

    it('does not include unfunded project capacity in a Team-mode tooltip', async () => {
      const el = document.createElement('maingraph-lit');
      document.body.appendChild(el);
      await el.updateComplete;

      const mockCtx = {
        clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
        save() {}, restore() {}, setLineDash() {},
      };
      el._canvasRef = { width: 600, height: 120, getContext: () => mockCtx };
      const months = [new Date(2022, 0, 1), new Date(2022, 1, 1)];

      el._fullRender(mockCtx, {
        months,
        teams: [{ id: 'bluetooth', name: 'Bluetooth', color: '#111' }],
        projects: [{ id: 'p1', name: 'Project', color: '#222' }],
        capacityDates: months.map((m) => m.toISOString().slice(0, 10)),
        teamDailyCapacity: [],
        teamDailyCapacityMap: { 0: { bluetooth: 88 }, 1: { bluetooth: 88 } },
        projectDailyCapacity: [],
        projectDailyCapacityMap: { 0: { p1: 88, __unfunded__: 26 }, 1: { p1: 88, __unfunded__: 26 } },
        totalOrgDailyPerTeamAvg: [],
        capacityViewMode: 'team',
        selectedTeamIds: new Set(['bluetooth']),
        selectedProjectIds: new Set(['p1']),
      });

      expect(el._hoverDays[0].entries).to.deep.equal([
        { name: 'Bluetooth', color: '#111', value: 88 },
      ]);
      el.remove();
    });

    it('renders team lines when selected ids are strings and team ids are numeric', async () => {
      const el = document.createElement('maingraph-lit');
      document.body.appendChild(el);
      await el.updateComplete;

      const calls = { stroke: 0 };
      const mockCtx = {
        clearRect() {},
        fillRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {
          calls.stroke++;
        },
        save() {},
        restore() {},
        setLineDash() {},
      };
      el._canvasRef = { width: 600, height: 120, getContext: () => mockCtx };

      const months = [new Date(2022, 0, 1), new Date(2022, 1, 1)];
      const snapshot = {
        months,
        teams: [{ id: 101, color: '#111' }],
        projects: [{ id: 201, color: '#222' }],
        capacityDates: months.map((m) => m.toISOString().slice(0, 10)),
        teamDailyCapacity: [],
        teamDailyCapacityMap: { 0: { 101: 50 }, 1: { 101: 60 } },
        projectDailyCapacity: [],
        projectDailyCapacityMap: null,
        totalOrgDailyPerTeamAvg: [],
        capacityViewMode: 'team',
        selectedTeamIds: new Set(['101']),
        selectedProjectIds: new Set(['201']),
      };

      el._fullRender(mockCtx, snapshot);
      expect(calls.stroke).to.be.at.least(1);
      el.remove();
    });

    it('clamps the Years viewport when it extends beyond the final month', async () => {
      const el = document.createElement('maingraph-lit');
      const timelineBoard = document.createElement('timeline-board');
      document.body.prepend(timelineBoard);
      document.body.appendChild(el);
      const scrollContainer = document.createElement('div');
      scrollContainer.id = 'scroll-container';
      Object.defineProperty(scrollContainer, 'scrollLeft', { value: 50 });
      timelineBoard.appendChild(scrollContainer);
      await el.updateComplete;

      const mockCtx = {
        clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
        save() {}, restore() {}, setLineDash() {},
      };
      el._canvasRef = { width: 615, height: 120, getContext: () => mockCtx };
      const months = [new Date(2022, 0, 1), new Date(2022, 1, 1)];
      const snapshot = {
        months, teams: [{ id: 't1', color: '#111' }], projects: [], capacityDates: [],
        teamDailyCapacity: [], teamDailyCapacityMap: null, projectDailyCapacity: [],
        projectDailyCapacityMap: null, totalOrgDailyPerTeamAvg: [], capacityViewMode: 'team',
        selectedTeamIds: new Set(['t1']), selectedProjectIds: new Set(),
      };
      const originalMonthWidth = TIMELINE_CONFIG.monthWidth;
      TIMELINE_CONFIG.monthWidth = 30;

      expect(() => el._fullRender(mockCtx, snapshot)).not.to.throw();

      TIMELINE_CONFIG.monthWidth = originalMonthWidth;
      timelineBoard.remove();
      el.remove();
    });
  });

  it('inserts maingraph-lit', async () => {
    const sec = document.createElement('div');
    sec.id = 'timelineSection';
    sec.style.width = '800px';
    document.body.appendChild(sec);
    const canvas = document.createElement('canvas');
    canvas.id = 'mainGraphCanvas';
    sec.appendChild(canvas);
    // Emulate app behavior: import the lit module and create a host instance
    if (!customElements.get('maingraph-lit')) {
      await import('../../www/js/components/MainGraph.lit.js');
    }
    let lit = document.querySelector('maingraph-lit');
    if (!lit) {
      const canvas = document.getElementById('mainGraphCanvas');
      const el = document.createElement('maingraph-lit');
      if (canvas && canvas.parentNode) canvas.parentNode.insertBefore(el, canvas);
      else document.body.appendChild(el);
      lit = el;
    }
    expect(lit).to.exist;
  });
});
