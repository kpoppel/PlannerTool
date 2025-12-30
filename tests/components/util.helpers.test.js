import { expect } from '@open-wc/testing';
import { parseDate, formatDate, addDays, addMonths, dateRangeInclusiveMonths } from '../../www/js/components/util.js';

describe('util helpers', () => {
  it('parseDate handles strings, Date objects and null', () => {
    const d1 = parseDate('2025-03-05');
    expect(formatDate(d1)).to.equal('2025-03-05');
    const src = new Date(2025,2,6);
    const d2 = parseDate(src);
    expect(formatDate(d2)).to.equal('2025-03-06');
    const d3 = parseDate(null);
    expect(d3).to.equal(null);
  });

  it('addDays advances date correctly', () => {
    const d = new Date(2025,0,1);
    const n = addDays(d, 5);
    expect(formatDate(n)).to.equal('2025-01-06');
  });

  it('addMonths preserves clamped day for month overflow', () => {
    const d = new Date(2025,0,31); // Jan 31
    const m = addMonths(d, 1); // Feb -> should clamp to Feb 28 (or 29 if leap)
    // February 2025 has 28 days
    expect(formatDate(m)).to.equal('2025-02-28');
  });

  it('dateRangeInclusiveMonths lists month starts between dates', () => {
    const start = new Date(2025,0,15);
    const end = new Date(2025,3,2);
    const arr = dateRangeInclusiveMonths(start, end);
    expect(arr[0].getMonth()).to.equal(0);
    expect(arr[arr.length-1].getMonth()).to.equal(3);
  });
});
