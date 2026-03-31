import { expect } from '@esm-bundle/chai';
import '../../www/js/components/Timeline.lit.js';
import { getMonthWidthForScale, _resetTimelineState, getTimelineMonths, setTimelinePanningAllowed } from '../../www/js/components/Timeline.lit.js';

describe('Timeline expanded tests', () => {
  it('getMonthWidthForScale returns configured widths and falls back', () => {
    expect(getMonthWidthForScale('weeks')).to.equal(240);
    expect(getMonthWidthForScale('months')).to.equal(120);
    expect(getMonthWidthForScale('quarters')).to.equal(60);
    expect(getMonthWidthForScale('years')).to.equal(30);
    // unknown -> default 120
    expect(getMonthWidthForScale('nonsense')).to.equal(120);
  });

  it('_resetTimelineState and getTimelineMonths work', () => {
    _resetTimelineState();
    const months = getTimelineMonths();
    expect(Array.isArray(months)).to.equal(true);
    expect(months.length).to.equal(0);
  });

  it('setTimelinePanningAllowed toggles without throwing', () => {
    // ensure toggling does not throw and is idempotent
    setTimelinePanningAllowed(false);
    setTimelinePanningAllowed(true);
  });
});
