import { expect } from '@open-wc/testing';

import { ScenarioManager } from '../../www/js/services/ScenarioManager.js';

class DummyBus { constructor(){ this.events = []; } emit(e,p){ this.events.push({ e,p }); } }
class DummyBaselineStore { constructor(){ this._data = {}; } }

describe('ScenarioManager', () => {
  let bus, store, sm, stateContext;
  beforeEach(() => {
    bus = new DummyBus();
    store = new DummyBaselineStore();
    stateContext = { captureCurrentFilters: () => ({ projects: [] }), captureCurrentView: () => ({}) };
    sm = new ScenarioManager(bus, store, stateContext);
  });

  it('requires dependencies', () => {
    let threw = false;
    try{ new ScenarioManager(); }catch(e){ threw = true; }
    expect(threw).to.equal(true);
  });

  it('cloneScenario creates a new scenario and emits UPDATE', () => {
    const created = sm.cloneScenario('baseline', 'My Name');
    expect(created).to.have.property('id');
    expect(sm.scenarios).to.include(created);
    expect(bus.events.some(x => x.e && x.e.toString && x.e.toString().includes('scenario'))).to.equal(true);
  });

  it('generateScenarioDefaultName increments properly', () => {
    // Add an existing patterned name
    sm.scenarios.push({ id:'a', name: '12-31 Scenario 2' });
    const name = sm.generateScenarioDefaultName();
    expect(name).to.match(/\d{2}-\d{2} Scenario \d+/);
  });

  it('ensureUniqueScenarioName appends counter', () => {
    sm.scenarios.push({ id:'a', name: 'X' });
    const name = sm.ensureUniqueScenarioName('X');
    expect(name).to.not.equal('X');
  });

  it('activateScenario handles baseline/unknown/valid', () => {
    // baseline
    let res = sm.activateScenario('baseline');
    expect(res).to.equal(null);
    // unknown
    res = sm.activateScenario('nope');
    expect(res).to.equal(null);
    // create and activate
    const c = sm.cloneScenario('baseline','A');
    const act = sm.activateScenario(c.id);
    expect(act).to.equal(c);
  });

  it('deleteScenario removes and emits activated when needed', () => {
    const c = sm.cloneScenario('baseline','ToDel');
    sm.activeScenarioId = c.id;
    sm.deleteScenario(c.id);
    expect(sm.scenarios.find(s=>s.id===c.id)).to.equal(undefined);
    // after delete active should be baseline
    expect(sm.activeScenarioId).to.equal('baseline');
  });

  it('setScenarioOverride writes override on active scenario', () => {
    const c = sm.cloneScenario('baseline','Ov');
    sm.activateScenario(c.id);
    sm.setScenarioOverride('feat1','2025-01-01','2025-02-02');
    const active = sm.getActiveScenario();
    expect(active.overrides['feat1'].start).to.equal('2025-01-01');
  });

  it('renameScenario and isScenarioDirty/markScenarioSaved', () => {
    const c = sm.cloneScenario('baseline','RenameMe');
    sm.renameScenario(c.id, 'Renamed');
    expect(sm.scenarios.find(s=>s.id===c.id).name).to.match(/Renamed/);
    expect(sm.isScenarioDirty(c.id)).to.equal(true);
    sm.markScenarioSaved(c.id);
    expect(sm.isScenarioDirty(c.id)).to.equal(false);
  });

  it('cloned scenario is independent from source (mutations do not propagate)', () => {
    // create an initial scenario with an override
    const original = sm.cloneScenario('baseline', 'Original');
    original.overrides = { 'F1': { start: '2025-01-01', end: '2025-02-01' } };

    // clone the original
    const cloned = sm.cloneScenario(original.id, 'Clone');

    // mutate original
    original.overrides['F1'].start = '2030-01-01';

    // cloned should NOT see the mutation
    expect(cloned.overrides['F1'].start).to.not.equal('2030-01-01');
  });
});
