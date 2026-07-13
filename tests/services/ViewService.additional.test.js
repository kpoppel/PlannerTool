import { expect } from '@esm-bundle/chai';
import { ViewService } from '../../www/js/services/ViewService.js';
import {
  FilterEvents,
  FeatureEvents,
  TimelineEvents,
} from '../../www/js/core/EventRegistry.js';

describe('ViewService additional coverage', () => {
  let emitCalls;
  let bus;
  let vs;

  beforeEach(() => {
    emitCalls = [];
    bus = { emit: (event, data) => emitCalls.push({ event, data }) };
    vs = new ViewService(bus);
  });

  it('setShowUnallocatedCards and setShowUnplannedWork emit events and update state', () => {
    vs.setShowUnallocatedCards(false);
    expect(vs.showUnassignedCards).to.equal(false);
    expect(emitCalls.some((c) => c.event === FilterEvents.CHANGED)).to.be.true;
    expect(emitCalls.some((c) => c.event === FeatureEvents.UPDATED)).to.be.true;

    emitCalls = [];
    vs.setShowUnplannedWork(false);
    expect(vs.showUnplannedWork).to.equal(false);
    expect(emitCalls.some((c) => c.event === FilterEvents.CHANGED)).to.be.true;
    expect(emitCalls.some((c) => c.event === FeatureEvents.UPDATED)).to.be.true;
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
    const scaleEvt = emitCalls.find((c) => c.event === TimelineEvents.SCALE_CHANGED);
    expect(scaleEvt).to.exist;
    expect(scaleEvt.data.scale).to.equal('months');
  });
});
