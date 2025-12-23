import { expect } from '@open-wc/testing';

describe('Providers, FilterManager and CapacityCalculator (consolidated)', () => {
  describe('ProviderLocalStorage', () => {
    it('save and list scenarios', async () => {
      const mod = await import('../../www/js/services/providerLocalStorage.js');
      const provider = new mod.ProviderLocalStorage();
      localStorage.removeItem('scenarios');
      await provider.saveScenario({ id: 's1', name: 'S1' });
      const list = await provider.listScenarios();
      expect(list).to.be.an('array');
      expect(list.length).to.equal(1);
      expect(list[0].id).to.equal('s1');
    });

    it('renameScenario updates entry', async () => {
      const mod = await import('../../www/js/services/providerLocalStorage.js');
      const provider = new mod.ProviderLocalStorage();
      localStorage.setItem('scenarios', JSON.stringify([{ id:'s2', name:'Old' }]));
      const res = await provider.renameScenario('s2', 'New');
      expect(res.name).to.equal('New');
    });

    it('saveProjectColor and loadColors', async () => {
      const mod = await import('../../www/js/services/providerLocalStorage.js');
      const provider = new mod.ProviderLocalStorage();
      localStorage.removeItem('az_planner:user_prefs:v1');
      await provider.saveProjectColor('p1', '#abc');
      const res = await provider.loadColors();
      expect(res.projectColors.p1).to.equal('#abc');
    });
  });

  describe('ProviderREST coverage', () => {
    it('listScenarios and getScenario emit events', async () => {
      const mod = await import('/www/js/services/providerREST.js');
      const provider = new mod.ProviderREST();
      const metas = [{ id: 's1' }, { id: 'baseline' }];
      globalThis.fetch = async (url, opts) => {
        if (url.includes('/api/scenario?id=')) {
          return { ok: true, json: async () => ({ id: 's1', name: 'S1', overrides: {} }) };
        }
        if (url.startsWith('/api/scenario') && (!opts || opts.method !== 'POST')) {
          return { ok: true, json: async () => metas };
        }
        return { ok: false };
      };
      const busMod = await import('../../www/js/core/EventBus.js');
      const bus = busMod.bus;
      if (bus.listeners && typeof bus.listeners.clear === 'function') bus.listeners.clear();
      const events = [];
      bus.on('scenarios:changed', (p) => events.push({ type: 'changed', p }));
      bus.on('scenarios:data', (p) => events.push({ type: 'data', p }));

      const list = await provider.listScenarios();
      expect(Array.isArray(list)).to.equal(true);
      expect(list.length).to.equal(2);

      const loaded = await provider.getScenario('s1');
      expect(loaded.id).to.equal('s1');

      const loadedAll = await provider.loadAllScenarios();
      expect(Array.isArray(loadedAll)).to.equal(true);
      expect(events.some(e=>e.type==='changed')).to.equal(true);
      expect(events.some(e=>e.type==='data')).to.equal(true);
    });

    it('getFeatures maps parent relation to parentEpic', async () => {
      const mod = await import('/www/js/services/providerREST.js');
      const provider = new mod.ProviderREST();
      globalThis.fetch = async (url, opts) => {
        if (url.startsWith('/api/tasks')) {
          return { ok: true, json: async () => [ { id: 'f1', relations: [{ type: 'Parent', id: 'e1' }] } ] };
        }
        return { ok: false };
      };
      const features = await provider.getFeatures();
      expect(features[0].parentEpic).to.equal('e1');
    });

    it('getTeams and getProjects return arrays with selected true', async () => {
      const mod = await import('/www/js/services/providerREST.js');
      const provider = new mod.ProviderREST();
      globalThis.fetch = async (url, opts) => {
        if (url.startsWith('/api/teams')) return { ok: true, json: async () => [{ id: 't1' }] };
        if (url.startsWith('/api/projects')) return { ok: true, json: async () => [{ id: 'p1' }] };
        return { ok: false };
      };
      const teams = await provider.getTeams();
      const projects = await provider.getProjects();
      expect(teams[0].selected).to.equal(true);
      expect(projects[0].selected).to.equal(true);
    });
  });

  describe('FilterManager and CapacityCalculator', () => {
    it('FilterManager basic toggles and events', async () => {
      const mod = await import('../../www/js/services/FilterManager.js');
      const { FilterManager } = mod;
      const busModule = await import('../../www/js/core/EventBus.js');
      const bus = busModule.bus;
      if (bus.listeners && typeof bus.listeners.clear === 'function') bus.listeners.clear();

      const projects = [ { id: 'p1', name: 'P1', selected: true }, { id: 'p2', name: 'P2', selected: false } ];
      const teams = [ { id: 't1', name: 'T1', selected: true }, { id: 't2', name: 'T2', selected: false } ];
      const manager = new FilterManager(bus, projects, teams);

      manager.toggleProject('p1');
      expect(projects[0].selected).to.equal(false);

      manager.selectAllTeams();
      expect(teams.every(t => t.selected)).to.be.true;
    });

    it('CapacityCalculator calculates capacities', async () => {
      const mod = await import('../../www/js/services/CapacityCalculator.js');
      const { CapacityCalculator } = mod;
      const busModule = await import('../../www/js/core/EventBus.js');
      const bus = busModule.bus;
      bus.listeners.clear();

      const teams = [ { id: 't1' }, { id: 't2' } ];
      const projects = [ { id: 'p1' } ];
      const features = [ { id: 'f1', project: 'p1', status: 'In Progress', start: '2024-01-01', end: '2024-01-10', capacity: [ { team: 't1', capacity: 5 }, { team: 't2', capacity: 3 } ] } ];
      const filters = { selectedProjects: ['p1'], selectedTeams: ['t1', 't2'], selectedStates: ['In Progress'] };

      const calculator = new CapacityCalculator(bus);
      const result = calculator.calculate(features, filters, teams, projects);
      expect(result.dates).to.be.an('array');
      expect(result.teamDailyCapacityMap[0]['t1']).to.equal(5);
    });
  });
});
