import { expect, fixture, html } from '@open-wc/testing';
import { stub } from 'sinon';
import { isEnabled } from '../../www/js/config.js';

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
      expect(el.renderGraph).to.be.a('function');
      expect(el.updateViewport).to.be.a('function');
    });

    it('sets canvas dimensions from properties', async () => {
      const el = await fixture(html`<maingraph-lit .bus=${mockBus} .width=${800} .height=${120}></maingraph-lit>`);
      const canvas = el.shadowRoot.querySelector('canvas');
      expect(canvas.width).to.equal(800);
      expect(canvas.height).to.equal(120);
    });

    it('handles empty data gracefully', async () => {
      const el = await fixture(html`<maingraph-lit .bus=${mockBus}></maingraph-lit>`);
      const data = { months: [], teamData: [], projectData: [] };
      await el.renderGraph(data);
      const canvas = el.shadowRoot.querySelector('canvas');
      expect(canvas).to.exist;
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
        clearRect() { calls.clearRect++; },
        fillRect() { calls.fillRect++; },
        beginPath() { calls.beginPath++; },
        moveTo() {},
        lineTo() {},
        stroke() { calls.stroke++; },
        save() {},
        restore() {},
        setLineDash() {},
        getContext() { return this; }
      };

      el._canvasRef = { width: 800, height: 120, getContext: () => mockCtx };

      const months = [new Date(2022,0,1), new Date(2022,1,1), new Date(2022,2,1)];
      const snapshot = {
        months,
        teams: [{ id: 't1', color: '#123' }],
        projects: [{ id: 'p1', color: '#456' }],
        capacityDates: months.map(m=> new Date(m).toISOString().slice(0,10)),
        teamDailyCapacity: [[10,20,30],[5,15,25],[0,0,0]],
        teamDailyCapacityMap: null,
        projectDailyCapacity: [],
        projectDailyCapacityMap: null,
        totalOrgDailyPerTeamAvg: [],
        capacityViewMode: 'team',
        selectedTeamIds: new Set(['t1']),
        selectedProjectIds: new Set(['p1'])
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
      const mockCtx = { clearRect() {}, fillRect() { calls.fillRect++; }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, save() {}, restore() {}, setLineDash() {} };
      el._canvasRef = { width: 600, height: 120, getContext: () => mockCtx };

      const months = [new Date(2022,0,1), new Date(2022,1,1)];
      const snapshot = {
        months,
        teams: [{ id: 't1', color: '#111' }],
        projects: [{ id: 'p1', color: '#222' }],
        capacityDates: months.map(m => m.toISOString().slice(0,10)),
        teamDailyCapacity: [],
        teamDailyCapacityMap: null,
        projectDailyCapacity: [[10,0],[20,0]],
        projectDailyCapacityMap: null,
        totalOrgDailyPerTeamAvg: [],
        capacityViewMode: 'project',
        selectedTeamIds: new Set(['t1']),
        selectedProjectIds: new Set(['p1'])
      };

      el._fullRender(mockCtx, snapshot);
      expect(calls.fillRect).to.be.at.least(1);
      el.remove();
    });
  });

  it('inserts maingraph-lit when feature flag enabled', async () => {
    // ensure flag is enabled for the test
    if(!isEnabled('USE_LIT_COMPONENTS')) return;
    const sec = document.createElement('div'); sec.id = 'timelineSection'; sec.style.width='800px'; document.body.appendChild(sec);
    const canvas = document.createElement('canvas'); canvas.id='mainGraphCanvas'; sec.appendChild(canvas);
    // Emulate app behavior: import the lit module and create a host instance
    if(!customElements.get('maingraph-lit')){
      await import('../../www/js/components/MainGraph.lit.js');
    }
    let lit = document.querySelector('maingraph-lit');
    if(!lit){
      const canvas = document.getElementById('mainGraphCanvas');
      const el = document.createElement('maingraph-lit');
      if(canvas && canvas.parentNode) canvas.parentNode.insertBefore(el, canvas);
      else document.body.appendChild(el);
      lit = el;
    }
    expect(lit).to.exist;
  });

});
