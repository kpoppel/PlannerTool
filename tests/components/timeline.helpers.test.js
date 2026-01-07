import { expect } from '@esm-bundle/chai';
import { getMonthWidthForScale } from '../../www/js/components/Timeline.lit.js';

describe('Timeline helpers', () => {
  it('getMonthWidthForScale returns expected widths', () => {
    expect(getMonthWidthForScale('weeks')).to.equal(240);
    expect(getMonthWidthForScale('months')).to.equal(120);
    expect(getMonthWidthForScale('quarters')).to.equal(60);
    expect(getMonthWidthForScale('years')).to.equal(30);
    // unknown falls back to 120
    expect(getMonthWidthForScale('invalid')).to.equal(120);
  });
});
