/**
 * Tests for ViewService packed mode (displayMode tri-state)
 */

import { expect } from '@esm-bundle/chai';
import { state } from '../../www/js/services/State.js';
import { ViewEvents, FeatureEvents } from '../../www/js/core/EventRegistry.js';

describe('ViewService — displayMode / packedMode', () => {
  let emitCalls;
  let vs;

  beforeEach(() => {
    emitCalls = [];
    const mockBus = { emit: (event, data) => emitCalls.push({ event, data }) };
    vs = state._viewService;
    vs.bus = mockBus;
    // Reset to defaults
    vs._displayMode = 'normal';
    vs._featureSortMode = 'rank';
  });

  describe('displayMode getter/setter', () => {
    it('defaults to "normal"', () => {
      expect(vs.displayMode).to.equal('normal');
    });

    it('setDisplayMode("compact") sets mode to compact', () => {
      vs.setDisplayMode('compact');
      expect(vs.displayMode).to.equal('compact');
    });

    it('setDisplayMode("packed") sets mode to packed', () => {
      vs.setDisplayMode('packed');
      expect(vs.displayMode).to.equal('packed');
    });

    it('setDisplayMode with invalid value falls back to "normal"', () => {
      vs.setDisplayMode('normal'); // ensure we start in a different state
      vs._displayMode = 'compact';
      vs.setDisplayMode('invalid');
      expect(vs.displayMode).to.equal('normal');
    });

    it('setting same mode does not emit events', () => {
      vs._displayMode = 'compact';
      vs.setDisplayMode('compact');
      expect(emitCalls).to.have.length(0);
    });
  });

  describe('condensedCards backward compatibility', () => {
    it('condensedCards is false when displayMode is "normal"', () => {
      vs._displayMode = 'normal';
      expect(vs.condensedCards).to.equal(false);
    });

    it('condensedCards is true when displayMode is "compact"', () => {
      vs._displayMode = 'compact';
      expect(vs.condensedCards).to.equal(true);
    });

    it('condensedCards is true when displayMode is "packed"', () => {
      vs._displayMode = 'packed';
      expect(vs.condensedCards).to.equal(true);
    });

    it('setCondensedCards(true) sets displayMode to "compact"', () => {
      vs.setCondensedCards(true);
      expect(vs.displayMode).to.equal('compact');
    });

    it('setCondensedCards(false) sets displayMode to "normal"', () => {
      vs._displayMode = 'compact';
      vs.setCondensedCards(false);
      expect(vs.displayMode).to.equal('normal');
    });

    it('setCondensedCards(false) from packed sets displayMode to "normal"', () => {
      vs._displayMode = 'packed';
      vs.setCondensedCards(false);
      expect(vs.displayMode).to.equal('normal');
    });
  });

  describe('packedMode getter', () => {
    it('packedMode is false when displayMode is "normal"', () => {
      vs._displayMode = 'normal';
      expect(vs.packedMode).to.equal(false);
    });

    it('packedMode is false when displayMode is "compact"', () => {
      vs._displayMode = 'compact';
      expect(vs.packedMode).to.equal(false);
    });

    it('packedMode is true when displayMode is "packed"', () => {
      vs._displayMode = 'packed';
      expect(vs.packedMode).to.equal(true);
    });
  });

  describe('event emission', () => {
    it('setDisplayMode emits ViewEvents.CONDENSED and FeatureEvents.UPDATED', () => {
      vs.setDisplayMode('packed');
      const condensedEvt = emitCalls.find((c) => c.event === ViewEvents.CONDENSED);
      const updatedEvt = emitCalls.find((c) => c.event === FeatureEvents.UPDATED);
      expect(condensedEvt).to.exist;
      expect(updatedEvt).to.exist;
    });

    it('setDisplayMode passes condensedCards value in CONDENSED event', () => {
      vs.setDisplayMode('packed');
      const condensedEvt = emitCalls.find((c) => c.event === ViewEvents.CONDENSED);
      // packed => condensedCards = true
      expect(condensedEvt.data).to.equal(true);
    });

    it('setDisplayMode("normal") passes false in CONDENSED event', () => {
      vs._displayMode = 'compact';
      vs.setDisplayMode('normal');
      const condensedEvt = emitCalls.find((c) => c.event === ViewEvents.CONDENSED);
      expect(condensedEvt.data).to.equal(false);
    });
  });

  describe('captureCurrentView / restore', () => {
    it('captureCurrentView includes displayMode', () => {
      vs._displayMode = 'packed';
      const snapshot = vs.captureCurrentView();
      expect(snapshot.displayMode).to.equal('packed');
    });

    it('captureCurrentView condensedCards reflects packed mode', () => {
      vs._displayMode = 'packed';
      const snapshot = vs.captureCurrentView();
      expect(snapshot.condensedCards).to.equal(true);
    });

    it('applyViewStateSilently restores displayMode', () => {
      vs.applyViewStateSilently({ displayMode: 'packed' });
      expect(vs._displayMode).to.equal('packed');
    });

    it('applyViewStateSilently falls back to condensedCards for old snapshots', () => {
      vs.applyViewStateSilently({ condensedCards: true });
      expect(vs._displayMode).to.equal('compact');
    });

    it('applyViewStateSilently condensedCards:false → normal', () => {
      vs._displayMode = 'packed';
      vs.applyViewStateSilently({ condensedCards: false });
      expect(vs._displayMode).to.equal('normal');
    });

    it('restoreView with displayMode:"packed" round-trips correctly', () => {
      vs.restoreView({ displayMode: 'packed' });
      expect(vs.displayMode).to.equal('packed');
      expect(vs.packedMode).to.equal(true);
    });
  });
});
