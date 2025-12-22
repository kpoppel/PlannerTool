import { expect, fixture, html } from '@open-wc/testing';
import { stub } from 'sinon';
import * as fcHelpers from '../../www/js/components/FeatureCard.lit.js';
import { state } from '../../www/js/services/State.js';

describe('FeatureCard Consolidated Tests', () => {
  before(async () => {
    // ensure custom element is defined for lit component tests
    if (!customElements.get('feature-card-lit')) {
      await import('../../www/js/components/FeatureCard.lit.js');
    }
  });

  describe('helpers and computePosition', () => {
    before(() => {
      state.projects = [{ id: 'p1', color: '#123', selected: true }];
      state.teams = [{ id: 't1', selected: true, color: '#abc' }];
      state.scenarios = [{ id: 'baseline' }];
      state.activeScenarioId = 'baseline';
      state.condensedCards = false;
    });

    it('laneHeight returns numeric value', () => {
      const h = fcHelpers.laneHeight();
      expect(h).to.be.a('number');
    });

    it('getBoardOffset returns 0 when no board', () => {
      const v = fcHelpers.getBoardOffset();
      expect(v).to.equal(0);
    });

    it('computePosition returns left and width for valid ranges', async () => {
      // prepare minimal timeline DOM and init
      const header = document.createElement('div'); header.id = 'timelineHeader'; document.body.appendChild(header);
      const section = document.createElement('div'); section.id = 'timelineSection'; section.style.width = '600px'; document.body.appendChild(section);
      const tl = document.createElement('timeline-lit'); header.appendChild(tl);
      const feat = { start: '2021-01-05', end: '2021-02-10' };
      // init timeline via import to ensure months computed
      const timeline = await import('../../www/js/components/Timeline.lit.js');
      await timeline.initTimeline();
      const pos = fcHelpers.computePosition(feat);
      expect(pos).to.be.an('object');
      expect(pos.left).to.be.a('number');
      expect(pos.width).to.be.a('number');
      header.remove(); section.remove();
    });

    it('laneHeight respects condensed flag and featureFlags branch', () => {
      const original = fcHelpers.featureFlags ? fcHelpers.featureFlags.USE_LIT_COMPONENTS : undefined;
      try{
        if(fcHelpers.featureFlags) fcHelpers.featureFlags.USE_LIT_COMPONENTS = false;
        state.condensedCards = true;
        const h = fcHelpers.laneHeight();
        expect(typeof h).to.equal('number');
      } finally {
        if(fcHelpers.featureFlags && original !== undefined) fcHelpers.featureFlags.USE_LIT_COMPONENTS = original;
        state.condensedCards = false;
      }
    });

    it('updateCardsById applies visuals to existing feature-card-lit elements', async () => {
      // ensure a board element exists
      let board = document.getElementById('featureBoard');
      if(!board){ board = document.createElement('div'); board.id = 'featureBoard'; document.body.appendChild(board); }
      const feat = { id: 'fx1', start: '2021-01-05', end: '2021-02-10', project: 'p1', capacity: [{team:'t1', capacity:10}], type: 'feature' };
      const source = [feat];
      // create a fake feature-card-lit element with applyVisuals spy
      const el = document.createElement('feature-card-lit');
      let called = false;
      el.applyVisuals = function(opts){ called = true; this._last = opts; };
      try{ el.feature = feat; }catch(e){}
      board.appendChild(el);

      const update = fcHelpers.updateCardsById || (await import('../../www/js/components/FeatureCard.lit.js')).updateCardsById;
      await update(board, ['fx1'], source);
      await new Promise(r => setTimeout(r, 0));
      expect(called).to.equal(true);
      board.removeChild(el);
    });
  });

  describe('lit component behaviour', () => {
    let mockBus;

    beforeEach(async () => {
      mockBus = { emit: stub(), on: stub(), off: stub() };
      await customElements.whenDefined('feature-card-lit');
    });

    it('renders title and exposes feature id', async () => {
      const el = await fixture(html`
        <feature-card-lit
          .feature=${{ id: 'F1', title: 'Test Feature', type: 'feature', start: '2025-01-01', end: '2025-01-15', project: 'P1', capacity: [] }}
          .bus=${mockBus}
        ></feature-card-lit>
      `);
      const title = el.shadowRoot.querySelector('.feature-title');
      expect(title).to.exist;
      expect(title.textContent.trim()).to.equal('Test Feature');
      // data-feature-id attribute set when feature assigned
      el.feature = { id: 42, title: 'Test Feature', dirty: false };
      await el.updateComplete;
      expect(el.getAttribute('data-feature-id')).to.equal('42');
    });

    it('applies styles via applyVisuals and classes reflect state', async () => {
      const el = await fixture(html`<feature-card-lit></feature-card-lit>`);
      el.feature = { id: 42, title: 'Test Feature', dirty: false };
      await el.updateComplete;
      el.applyVisuals({ left: 120, width: 240, selected: true, dirty: true });
      await el.updateComplete;
      expect(el.style.left).to.equal('120px');
      expect(el.style.width).to.equal('240px');
      el.inScenarioMode = true;
      el.applyVisuals({ dirty: true });
      await el.updateComplete;
      expect(el.classList.contains('dirty')).to.be.true;
    });

    it('emits details event on click', async () => {
      const feature = { id: 'F3', title: 'Clickable Feature', type: 'feature', start: '2025-01-01', end: '2025-01-15', project: 'P1', capacity: [] };
      const el = await fixture(html`<feature-card-lit .feature=${feature} .bus=${mockBus}></feature-card-lit>`);
      const card = el.shadowRoot.querySelector('.feature-card');
      card.click();
      expect(mockBus.emit).to.have.been.calledOnce;
      const emittedEvent = mockBus.emit.firstCall.args[0];
      if (typeof emittedEvent === 'symbol') {
        expect(String(emittedEvent)).to.include('details');
      } else {
        expect(emittedEvent).to.include('details');
      }
      expect(mockBus.emit.firstCall.args[1]).to.equal(feature);
    });

    it('renders load boxes and icons per feature type', async () => {
      const el = await fixture(html`
        <feature-card-lit
          .feature=${{
            id: 'F4', title: 'Team Feature', type: 'feature', start: '2025-01-01', end: '2025-01-15', project: 'P1', orgLoad: '50%',
            capacity: [ { team: 'T1', capacity: '30%' }, { team: 'T2', capacity: '20%' } ]
          }}
          .bus=${mockBus}
          .teams=${[
            { id: 'T1', name: 'Team 1', color: '#ff0000', selected: true },
            { id: 'T2', name: 'Team 2', color: '#00ff00', selected: true }
          ]}
          .condensed=${false}
        ></feature-card-lit>
      `);
      const teamBoxes = el.shadowRoot.querySelectorAll('.team-load-box');
      expect(teamBoxes.length).to.be.at.least(1);
      // epic and feature icons
      const epic = await fixture(html`<feature-card-lit .feature=${{ id: 'E1', type: 'epic', title: 'Epic' }} .bus=${mockBus}></feature-card-lit>`);
      expect(epic.shadowRoot.querySelector('.feature-card-icon.epic')).to.exist;
      const feat = await fixture(html`<feature-card-lit .feature=${{ id: 'F7', type: 'feature', title: 'Feat' }} .bus=${mockBus}></feature-card-lit>`);
      expect(feat.shadowRoot.querySelector('.feature-card-icon.feature').querySelector('svg')).to.exist;
    });
  });
});
