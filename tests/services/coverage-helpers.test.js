import { expect } from '@esm-bundle/chai';
import { bus, EventBus } from '../../www/js/core/EventBus.js';
import { dataService } from '../../www/js/services/dataService.js';
import { state } from '../../www/js/services/State.js';

describe('Coverage helpers', () => {
  it('exercise EventBus utilities', () => {
    // register, on/off, emit, once
    const sym = Symbol('test:event');
    if(bus instanceof EventBus){
      bus.registerEventType(sym, 'test:event');
    }
    let called = false;
    const h = (p)=> { called = true; };
    const unsub = bus.on(sym, h);
    bus.emit(sym, { ok: true });
    expect(called).to.equal(true);
    unsub();
    called = false;
    bus.emit(sym, { ok: true });
    expect(called).to.equal(false);

    let onceCalled = 0;
    bus.once(sym, ()=> onceCalled++);
    bus.emit(sym);
    bus.emit(sym);
    expect(onceCalled).to.equal(1);

    bus.enableHistoryLogging(10);
    bus.emit(sym, { x:1 });
    const hst = bus.getEventHistory();
    expect(Array.isArray(hst)).to.equal(true);
    bus.disableHistoryLogging();
  });

  it('exercise DataService read methods', async () => {
    // local provider calls - should be safe
    const colors = await dataService.getColorMappings();
    expect(colors).to.be.an('object');
    await dataService.updateProjectColor('p1', '#abc');
    await dataService.updateTeamColor('t1', '#def');
    // call other read methods which delegate to providers
    const projects = await dataService.getProjects();
    const teams = await dataService.getTeams();
    const features = await dataService.getFeatures();
    expect(Array.isArray(projects)).to.equal(true);
    expect(Array.isArray(teams)).to.equal(true);
    expect(Array.isArray(features)).to.equal(true);
  }).timeout(2000);

  it('exercise some state helpers', () => {
    // shallow calls that do not hit network
    state.availableStates = ['Open','Done'];
    state.selectedStateFilter = new Set(['Open']);
    state.toggleStateSelected('Open');
    expect(state.selectedStateFilter instanceof Set).to.equal(true);
    state.setAllStatesSelected(true);
    expect(state.selectedStateFilter.size).to.be.at.least(1);
  });
});
