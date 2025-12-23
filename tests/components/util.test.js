import { expect } from '@open-wc/testing';
import { parseDate, formatDate, addMonths, addDays, dateRangeInclusiveMonths } from '../../www/js/components/util.js';

describe('Util helpers consolidated', () => {
  it('parseDate accepts Date and ISO strings and null', () => {
    const d1 = parseDate('2020-02-20'); expect(d1 instanceof Date).to.be.true; expect(d1.getFullYear()).to.equal(2020);
    const src = new Date(2021,0,15); const d2 = parseDate(src); expect(d2.getTime()).to.equal(src.getTime());
    expect(parseDate(null)).to.equal(null);
  });

  it('formatDate formats to yyyy-mm-dd and addDays works', () => {
    const d = new Date(2022,11,5); const s = formatDate(d); expect(s).to.equal('2022-12-05');
    const d2 = new Date(2025,11,20); const d3 = addDays(d2,5); expect(d3.getDate()).to.equal(25);
  });

  it('addMonths advances months and clamps month ends', () => {
    const d = new Date(2021,0,31); const plus1 = addMonths(d,1); expect(plus1.getMonth()).to.equal(1); expect(plus1.getDate()).to.be.oneOf([28,29]);
    const dec = new Date(2021,11,15); const plus2 = addMonths(dec,2); expect(plus2.getFullYear() >= 2022).to.be.true;
  });

  it('dateRangeInclusiveMonths returns inclusive month boundaries', () => {
    const a = new Date(2021,0,15); const b = new Date(2021,3,2); const range = dateRangeInclusiveMonths(a,b); expect(range.length).to.equal(4); expect(range[0].getMonth()).to.equal(0); expect(range[3].getMonth()).to.equal(3);
    const start = new Date(2021,0,15); const end = new Date(2021,2,5); const arr = dateRangeInclusiveMonths(start,end); expect(arr.length).to.equal(3); expect(arr[0].getDate()).to.equal(1);
  });
});
