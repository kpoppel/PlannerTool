import { expect } from '@esm-bundle/chai';
import { getTimelineMonths, initTimeline, _resetTimelineState } from '../../www/js/components/Timeline.lit.js';
import { TIMELINE_CONFIG } from '../../www/js/components/Timeline.lit.js';

describe('Timeline adapter', () => {
  beforeEach(() => {
    // ensure clean state
    _resetTimelineState();
    // ensure there's a container for timeline-lit if needed by init
    const t = document.createElement('timeline-lit');
    document.body.appendChild(t);
  });

  afterEach(() => {
    const t = document.querySelector('timeline-lit');
    if(t) t.remove();
    _resetTimelineState();
  });

  it('getTimelineMonths initially empty then initTimeline runs without throwing', async () => {
    expect(getTimelineMonths()).to.be.an('array');
    await initTimeline();
    // after initTimeline, months should be an array (may be non-empty depending on state)
    const months = getTimelineMonths();
    expect(months).to.be.an('array');
  });

  it('reset clears monthsCache', () => {
    _resetTimelineState();
    expect(getTimelineMonths().length).to.equal(0);
  });

  it('TIMELINE_CONFIG has monthWidth numeric', () => {
    expect(TIMELINE_CONFIG).to.have.property('monthWidth');
    expect(typeof TIMELINE_CONFIG.monthWidth).to.equal('number');
  });
});
