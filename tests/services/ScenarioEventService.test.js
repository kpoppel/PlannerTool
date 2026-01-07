import { expect } from '@esm-bundle/chai';
import { ScenarioEventService } from '../../www/js/services/ScenarioEventService.js';
import { ScenarioEvents, FeatureEvents } from '../../www/js/core/EventRegistry.js';

describe('ScenarioEventService basic flows', () => {
  let bus;
  let scenarioManager;
  let viewService;
  let svc;

  beforeEach(() => {
    bus = {
      listeners: new Map(),
      on(e, h) { const set = this.listeners.get(e) || []; set.push(h); this.listeners.set(e, set); },
      emit(e, p) { const hs = this.listeners.get(e) || []; for (const h of hs) h(p); }
    };

    scenarioManager = { scenarios: [], activeScenarioId: null, getAllScenarios() { return []; }, markScenarioSaved() {} };
    viewService = { captureCurrentView() { return { zoom: 'months' }; } };

    svc = new ScenarioEventService(bus, scenarioManager, viewService);
  });

  it('initDefaultScenario creates baseline readonly scenario', () => {
    svc.initDefaultScenario(() => ({ projects: [] }));
    const s = svc.getScenarioById('baseline');
    expect(s).to.exist;
    expect(s.readonly).to.equal(true);
    expect(scenariomanagerCheck(svc)).to.equal(true);
  });

  function scenariomanagerCheck(s) { return s._scenarioManager.activeScenarioId === s._activeScenarioId; }

  it('handleScenariosData merges scenarios and emits events', () => {
    // attach bus handlers to capture emits
    let listEmitted = false;
    let activatedEmitted = false;
    bus.on(ScenarioEvents.LIST, () => { listEmitted = true; });
    bus.on(ScenarioEvents.ACTIVATED, () => { activatedEmitted = true; });

    // prepare current capture functions
    svc._captureCurrentFilters = () => ({ projects: [] });
    svc._captureCurrentView = () => ({ zoom: 'months' });

    svc._handleScenariosData([{ id: 's1', name: 'S1' }]);

    expect(svc.getScenarios().some(x => x.id === 's1')).to.equal(true);
    expect(listEmitted).to.equal(true);
    expect(activatedEmitted).to.equal(true);
  });

  it('emitScenarioUpdated emits and refreshes list', () => {
    let updated = false;
    bus.on(ScenarioEvents.UPDATED, () => { updated = true; });
    svc.emitScenarioUpdated('x', { foo: 'bar' });
    expect(updated).to.equal(true);
  });
});
