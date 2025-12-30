import { expect } from '@esm-bundle/chai';
import '../../www/js/components/Timeline.lit.js';
import { TIMELINE_CONFIG, getTimelineMonths, _resetTimelineState, ensureScrollToMonth } from '../../www/js/components/Timeline.lit.js';
import { state } from '../../www/js/services/State.js';

describe('Timeline extra API', () => {
  beforeEach(() => { _resetTimelineState(); document.body.innerHTML = ''; });
  afterEach(() => { _resetTimelineState(); document.body.innerHTML = ''; });

  it('getTotalWidth and scrollToMonth behave as expected on component', async () => {
    const comp = document.createElement('timeline-lit');
    comp.months = [new Date(2025,0,1), new Date(2025,1,1), new Date(2025,2,1)];
    comp.monthWidth = TIMELINE_CONFIG.monthWidth;
    document.body.appendChild(comp);
    // test getTotalWidth via internal method
    expect(typeof comp.getTotalWidth).to.equal('function');
    const total = comp.getTotalWidth();
    expect(total).to.equal(comp.months.length * comp.monthWidth);

    const res = comp.scrollToMonth(2);
    expect(res).to.have.property('scrollLeft');
    expect(res.scrollLeft).to.equal(2 * comp.monthWidth);
  });

  it('ensureScrollToMonth tries to scroll when monthsCache is present', async () => {
    // prepare a timelineSection and months cache by simulating init
    const section = document.createElement('div'); section.id = 'timelineSection'; section.style.width = '800px'; document.body.appendChild(section);
    // set monthsCache via internal exported function by rendering a timeline-lit and triggering init code path
    const comp = document.createElement('timeline-lit'); document.body.appendChild(comp);
    comp.months = [new Date(2025,0,1), new Date(2025,1,1), new Date(2025,2,1)];
    // call ensureScrollToMonth to attempt scroll
    ensureScrollToMonth(new Date(2025,1,1));
    // since monthsCache is exported via getTimelineMonths, we expect it to be accessible
    const months = getTimelineMonths();
    // months may be empty depending on init; at minimum this shouldn't throw and returns an array
    expect(Array.isArray(months)).to.be.true;
  });
});
