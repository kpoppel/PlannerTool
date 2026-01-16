import { expect } from '@open-wc/testing';
import { SidebarPersistenceService } from '../../../www/js/services/SidebarPersistenceService.js';

describe('SidebarPersistenceService', () => {
  it('captures sidebar state including section collapsed flags', () => {
    const svc = new SidebarPersistenceService({});
    const state = {
      projects: [{ id: 'p1', selected: true }, { id: 'p2', selected: false }],
      teams: [{ id: 't1', selected: false }]
    };
    const viewService = { captureCurrentView: () => ({ zoom: 'months' }) };

    const sidebarEl = document.createElement('div');
    const sections = ['viewOptionsSection','projectsSection','teamsSection','scenariosSection','toolsSection'];
    sections.forEach((id, idx) => {
      const sec = document.createElement('section');
      sec.id = id;
      const header = document.createElement('div'); header.className='sidebar-section-header-collapsible';
      const content = document.createElement('div');
      if(idx % 2 === 0) content.classList.add('sidebar-section-collapsed');
      sec.appendChild(header); sec.appendChild(content);
      sidebarEl.appendChild(sec);
    });

    const snap = svc.captureSidebarState(state, viewService, sidebarEl);
    expect(snap).to.be.an('object');
    expect(snap.viewOptions).to.deep.equal({ zoom: 'months' });
    expect(snap.projects.p1).to.equal(true);
    expect(Object.keys(snap.sectionStates).length).to.equal(sections.length);
  });

  it('restore returns false when no saved state', async () => {
    const dataService = { getLocalPref: async () => null };
    const svc = new SidebarPersistenceService(dataService);
    const result = await svc.restoreSidebarState({}, {}, document.createElement('div'));
    expect(result).to.equal(false);
  });

  it('restores saved state and calls viewService.restoreView and state setters', async () => {
    const saved = {
      projects: { p1: false },
      teams: { t1: true },
      viewOptions: { zoom: 'weeks' },
      sectionStates: { viewOptionsSection: false }
    };
    const dataService = { getLocalPref: async () => saved, setLocalPref: async () => true };
    const svc = new SidebarPersistenceService(dataService);

    const state = {
      projects: [{ id: 'p1', selected: true }],
      teams: [{ id: 't1', selected: false }],
      setProjectSelected: (id, val) => { state.projects[0].selected = val; },
      setTeamSelected: (id, val) => { state.teams[0].selected = val; }
    };
    state.teams = [{ id: 't1', selected: false }];

    let restored = null;
    const viewService = { restoreView: (v) => { restored = v; } };

    // create DOM with viewOptionsSection present
    const sidebarEl = document.createElement('div');
    const sec = document.createElement('section'); sec.id = 'viewOptionsSection';
    sec.appendChild(document.createElement('div'));
    const content = document.createElement('div'); content.classList.add('sidebar-section-collapsed');
    sec.appendChild(content);
    sidebarEl.appendChild(sec);

    const result = await svc.restoreSidebarState(state, viewService, sidebarEl);
    expect(result).to.equal(true);
    expect(restored).to.deep.equal({ zoom: 'weeks' });
    expect(state.projects[0].selected).to.equal(false);
    expect(state.teams[0].selected).to.equal(true);
  });

  it('saveImmediately calls setLocalPref and clearSavedState calls setLocalPref with null', async () => {
    const calls = [];
    const dataService = { setLocalPref: async (k, v) => { calls.push({ k, v }); return true; } };
    const svc = new SidebarPersistenceService(dataService);
    const state = { projects: [] };
    const viewService = { captureCurrentView: () => ({}) };
    const sidebarEl = document.createElement('div');

    await svc._saveImmediately(state, viewService, sidebarEl);
    expect(calls.length).to.be.greaterThan(0);
    await svc.clearSavedState();
    expect(calls[calls.length-1].v).to.equal(null);
  });
});
