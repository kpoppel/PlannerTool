import { expect } from '@open-wc/testing';

import { FilterManager } from '../../www/js/services/FilterManager.js';

class DummyBus {
  constructor(){ this.events = []; }
  emit(e, payload){ this.events.push({ e, payload }); }
}

describe('FilterManager', () => {
  let bus, projects, teams, fm;
  beforeEach(() => {
    bus = new DummyBus();
    projects = [ { id:'p1', selected:true }, { id:'p2', selected:false } ];
    teams = [ { id:'t1', selected:true }, { id:'t2', selected:false } ];
    fm = new FilterManager(bus, projects, teams);
  });

  it('toggles project selection and emits events', () => {
    fm.toggleProject('p2');
    expect(projects.find(p => p.id==='p2').selected).to.equal(true);
    // ensure two events were emitted (projects changed + feature updated)
    expect(bus.events.length).to.equal(2);
    expect(bus.events[0].payload).to.equal(projects);
  });

  it('selects and deselects all projects', () => {
    fm.selectAllProjects();
    expect(projects.every(p => p.selected)).to.equal(true);
    fm.deselectAllProjects();
    expect(projects.every(p => !p.selected)).to.equal(true);
  });

  it('getSelectedProjects returns ids', () => {
    projects[1].selected = true;
    const ids = fm.getSelectedProjects();
    expect(ids).to.include('p1'); expect(ids).to.include('p2');
  });

  it('toggles team selection and emits events', () => {
    fm.toggleTeam('t2');
    expect(teams.find(t => t.id==='t2').selected).to.equal(true);
    // team changed + feature updated
    expect(bus.events.length).to.equal(2);
    expect(bus.events[0].payload).to.equal(teams);
  });

  it('selects and deselects all teams', () => {
    fm.selectAllTeams(); expect(teams.every(t => t.selected)).to.equal(true);
    fm.deselectAllTeams(); expect(teams.every(t => !t.selected)).to.equal(true);
  });

  it('captures and applies filters', () => {
    projects[0].selected = false; teams[1].selected = true;
    const capture = fm.captureFilters();
    expect(capture.projects).to.be.an('array'); expect(capture.teams).to.be.an('array');
    // apply inverse
    fm.applyFilters({ projects: ['p1'], teams: ['t2'] });
    expect(projects[0].selected).to.equal(true);
    expect(teams[1].selected).to.equal(true);
  });

  it('reset selects all items', () => {
    projects.forEach(p => p.selected = false); teams.forEach(t => t.selected = false);
    fm.reset();
    expect(projects.every(p => p.selected)).to.equal(true);
    expect(teams.every(t => t.selected)).to.equal(true);
  });
});
