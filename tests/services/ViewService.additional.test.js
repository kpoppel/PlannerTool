import { expect } from '@esm-bundle/chai';
import { state } from '../../www/js/services/State.js';
import { FilterEvents, FeatureEvents, TimelineEvents } from '../../www/js/core/EventRegistry.js';

describe('ViewService additional coverage', () => {
  let emitCalls;
  let bus;
  let vs;

  beforeEach(() => {
    emitCalls = [];
    bus = { emit: (event, data) => emitCalls.push({ event, data }) };
    vs = state._view_service || state._viewService;
    vs = state._viewService;
    vs.bus = bus;
    vs._timelineScale = 'months';
    vs._showEpics = true;
    vs._showFeatures = true;
    vs._showDependencies = false;
    vs._showUnassignedCards = true;
    vs._showUnplannedWork = true;
    vs._condensedCards = false;
    vs._capacityViewMode = 'team';
    vs._featureSortMode = 'rank';
  });

  it('setShowUnassignedCards and setShowUnplannedWork emit events and update state', () => {
    vs.setShowUnassignedCards(false);
    expect(vs.showUnassignedCards).to.equal(false);
    expect(emitCalls.some(c => c.event === FilterEvents.CHANGED)).to.be.true;
    expect(emitCalls.some(c => c.event === FeatureEvents.UPDATED)).to.be.true;

    emitCalls = [];
    vs.setShowUnplannedWork(false);
    expect(vs.showUnplannedWork).to.equal(false);
    expect(emitCalls.some(c => c.event === FilterEvents.CHANGED)).to.be.true;
    expect(emitCalls.some(c => c.event === FeatureEvents.UPDATED)).to.be.true;
  });

  it('invalid capacity view mode and sort mode are rejected', () => {
    vs.setCapacityViewMode('invalid');
    expect(vs.capacityViewMode).to.equal('team');

    vs.setFeatureSortMode('invalid');
    expect(vs.featureSortMode).to.equal('rank');
  });

  it('accepts legacy "days" timeline scale for compatibility', () => {
    emitCalls = [];
    // Force a different current scale so the setter will emit an event
    vs._timelineScale = 'weeks';
    vs.setTimelineScale('days');
    // production ViewService defaults unknown scales to 'months'
    expect(vs.timelineScale).to.equal('months');
    const scaleEvt = emitCalls.find(c => c.event === TimelineEvents.SCALE_CHANGED);
    expect(scaleEvt).to.exist;
    expect(scaleEvt.data.scale).to.equal('months');
  });
});
