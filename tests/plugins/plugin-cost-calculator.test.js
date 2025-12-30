import { expect } from '@open-wc/testing';
import { buildMonths, buildProjects, monthKey } from '../../../www/js/plugins/PluginCostCalculator.js';
import { toDate, firstOfMonth, lastOfMonth, addMonths, monthLabel } from '../../../www/js/plugins/PluginCostCalculator.js';
import { enable, disable } from '../../../www/js/config.js';

// Helper to create minimal project/feature structure returned by backend
function makeFeature(id, start, end, internalCost, externalCost, internalHours=0, externalHours=0){
  return {
    id: id,
    title: `f${id}`,
    start: start,
    end: end,
    metrics: { internal: { cost: internalCost, hours: internalHours }, external: { cost: externalCost, hours: externalHours } }
  };
}

describe('PluginCostCalculator - day-overlap distribution', ()=>{
  it('allocates full-month feature to that month', ()=>{
    const cfg = { dataset_start: '2026-06-01', dataset_end: '2026-06-30' };
    const months = buildMonths(cfg);
    const p = { id: 1, name: 'P', features: [ makeFeature(10, '2026-06-01', '2026-06-30', 100, 50, 10, 5) ] };
    const res = buildProjects([p], months, {});
    const project = res.projects[0];
    const mk = monthKey(months[0]);
    expect(project.features[0].values.internal[mk]).to.equal(100);
    expect(project.features[0].values.external[mk]).to.equal(50);
  });

  it('splits costs across months proportional to days', ()=>{
    const cfg = { dataset_start: '2026-06-01', dataset_end: '2026-07-31' };
    const months = buildMonths(cfg);
    // Feature spans 2026-06-01 .. 2026-07-01 (31 days in June, 1 day in July)
    const f = makeFeature(11, '2026-06-01', '2026-07-01', 36.31, 7.64, 36.31, 7.64);
    const p = { id: 1, name: 'P', features: [ f ] };
    const res = buildProjects([p], months, {});
    const feat = res.projects[0].features[0];
    const mkJun = monthKey(months[0]);
    const mkJul = monthKey(months[1]);
    // June should receive 30/31 of the total and July 1/31 (day-proportional)
    const expectedJun = 36.31 * (30/31);
    const expectedJul = 36.31 * (1/31);
    expect(feat.values.internal[mkJun]).to.be.closeTo(expectedJun, 0.05);
    expect(feat.values.internal[mkJul]).to.be.closeTo(expectedJul, 0.05);
    // totals should sum to the original metric (within rounding)
    const sum = Object.values(feat.values.internal).reduce((a,b)=>a+b,0);
    expect(sum).to.be.closeTo(36.31, 0.1);
  });

  it('handles single-day features inside a month', ()=>{
    const cfg = { dataset_start: '2026-06-01', dataset_end: '2026-06-30' };
    const months = buildMonths(cfg);
    const f = makeFeature(12, '2026-06-15', '2026-06-15', 10, 0, 8, 0);
    const p = { id: 1, name: 'P', features: [ f ] };
    const res = buildProjects([p], months, {});
    const feat = res.projects[0].features[0];
    const mkJun = monthKey(months[0]);
    expect(feat.values.internal[mkJun]).to.equal(10);
  });
});

describe('PluginCostCalculator - helpers and epic handling', ()=>{
  it('date helpers produce expected values', ()=>{
    const d = toDate('2026-12-15');
    expect(d.getUTCFullYear()).to.equal(2026);
    const f = firstOfMonth(d);
    const l = lastOfMonth(d);
    expect(f.getUTCDate()).to.equal(1);
    expect(f.getUTCMonth()).to.equal(11);
    expect(l.getUTCMonth()).to.equal(11);
    const nxt = addMonths(f, 1);
    // addMonths moves to first of next month in UTC; January is month 0
    expect(nxt.getUTCMonth()).to.equal(0);
    // monthLabel should return a non-empty string
    expect(monthLabel(f)).to.be.a('string').and.to.not.equal('');
  });

  it('epic ignores children when USE_EPIC_CAPACITY_GAP_FILLS is false', ()=>{
    const cfg = { dataset_start: '2026-01-01', dataset_end: '2026-03-31' };
    const months = buildMonths(cfg);
    const epic = { id: 100, name: 'P1', features: [
      { id: 100, title: 'EPIC', start: '2026-01-01', end: '2026-03-31', metrics: { internal: { cost: 300, hours: 30 }, external: { cost: 0, hours: 0 } } },
      { id: 101, title: 'C1', parentEpic: 100, start: '2026-01-01', end: '2026-01-31', metrics: { internal: { cost: 100, hours: 10 }, external: { cost: 0, hours: 0 } } },
      { id: 102, title: 'C2', parentEpic: 100, start: '2026-02-01', end: '2026-02-28', metrics: { internal: { cost: 100, hours: 10 }, external: { cost: 0, hours: 0 } } }
    ] };
    const res = buildProjects([epic], months, {});
    const project = res.projects[0];
    const featMap = Object.fromEntries(project.features.map(f=>[f.id,f]));
    // Since gap fills default is false in config.js, epic internalTotal should be sum of children (200)
    expect(featMap['100'].internalTotal).to.equal(200);
  });

  it('epic fills gaps when USE_EPIC_CAPACITY_GAP_FILLS is true', ()=>{
    // Enable the feature via the runtime API so config.featureFlags is updated
    enable('USE_EPIC_CAPACITY_GAP_FILLS');
    const cfg = { dataset_start: '2026-01-01', dataset_end: '2026-03-31' };
    const months = buildMonths(cfg);
    const epic = { id: 200, name: 'P2', features: [
      { id: 200, title: 'EPIC2', start: '2026-01-01', end: '2026-03-31', metrics: { internal: { cost: 300, hours: 30 }, external: { cost: 0, hours: 0 } } },
      { id: 201, title: 'C1', parentEpic: 200, start: '2026-01-01', end: '2026-01-31', metrics: { internal: { cost: 100, hours: 10 }, external: { cost: 0, hours: 0 } } }
    ] };
    const res = buildProjects([epic], months, {});
    const project = res.projects[0];
    const featMap = Object.fromEntries(project.features.map(f=>[f.id,f]));
    const mkFeb = monthKey(months[1]);
    // With gap fills enabled, epic should provide values in Feb (where no child exists)
    expect(featMap['200'].values.internal[mkFeb]).to.be.greaterThan(0);
  });
});
