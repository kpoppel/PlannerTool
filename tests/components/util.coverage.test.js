import { expect } from '@esm-bundle/chai';
import { parseDate, formatDate, addMonths, dateRangeInclusiveMonths, addDays } from '../../www/js/components/util.js';
import { computePosition, _test_resetCache } from '../../www/js/components/board-utils.js';

describe('Utility helpers coverage', () => {
  it('parseDate handles null, Date, and string', () => {
    expect(parseDate(null)).to.equal(null);
    const d = new Date(2025, 0, 2);
    const d2 = parseDate(d);
    expect(d2 instanceof Date).to.be.true;
    const s = parseDate('2025-01-03');
    expect(s.getFullYear()).to.equal(2025);
    expect(s.getMonth()).to.equal(0);
    expect(s.getDate()).to.equal(3);
  });

  it('formatDate and addDays/addMonths operate correctly', () => {
    const d = new Date(2025, 0, 31);
    const d2 = addMonths(d, 1);
    // Jan 31 + 1 month => Feb 28 (or 29) depending on year; here 2025 -> Feb 28
    expect(formatDate(d2)).to.match(/2025-02-(28|29)/);

    const d3 = addDays(new Date(2025, 0, 1), 5);
    expect(formatDate(d3)).to.equal('2025-01-06');
  });

  it('dateRangeInclusiveMonths returns month starts', () => {
    const start = new Date(2025, 0, 15);
    const end = new Date(2025, 2, 5);
    const arr = dateRangeInclusiveMonths(start, end);
    expect(arr.length).to.equal(3);
    expect(arr[0].getMonth()).to.equal(0);
    expect(arr[2].getMonth()).to.equal(2);
  });

  it('computePosition returns left and width for planned and unplanned features', () => {
    // Build simple months array (first of month)
    const months = [new Date(2025,0,1), new Date(2025,1,1), new Date(2025,2,1)];
    _test_resetCache();
    const featurePlanned = { start: '2025-01-02', end: '2025-01-10' };
    const res = computePosition(featurePlanned, months);
    expect(res).to.have.property('left');
    expect(res).to.have.property('width');

    // Unplanned feature (no start/end) should also produce numbers
    const featureUnplanned = {};
    const res2 = computePosition(featureUnplanned, months);
    expect(res2).to.have.property('left');
    expect(res2).to.have.property('width');
  });
});
