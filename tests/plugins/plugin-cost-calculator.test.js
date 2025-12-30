import { expect } from '@open-wc/testing';
import { buildMonths, buildProjects, monthKey } from '../../../www/js/plugins/PluginCostCalculator.js';

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
