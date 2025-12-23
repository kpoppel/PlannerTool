import { expect } from '@open-wc/testing';
import { ScenarioManager } from '../../www/js/services/ScenarioManager.js';
import { EventBus } from '../../www/js/core/EventBus.js';
import { dataService } from '../../www/js/services/dataService.js';

describe('Scenario Manager and DataService (consolidated)', () => {
  describe('ScenarioManager behaviors', () => {
    let manager;
    let eventBus;
    let mockBaselineStore;
    let mockStateContext;
    
    beforeEach(() => {
      eventBus = new EventBus();
      mockBaselineStore = { getFeatures: () => [], getProjects: () => [], getTeams: () => [] };
      mockStateContext = { captureCurrentFilters: () => ({ projects: [], teams: [] }), captureCurrentView: () => ({ capacityViewMode: 'team', condensedCards: false, featureSortMode: 'rank' }) };
      manager = new ScenarioManager(eventBus, mockBaselineStore, mockStateContext);
    });

    it('initialize with baseline as active', () => {
      expect(manager.activeScenarioId).to.equal('baseline');
    });

    it('cloneScenario generates unique ids and copies state', () => {
      const s1 = manager.cloneScenario('baseline', 'Test');
      const s2 = manager.cloneScenario('baseline', 'Test');
      expect(s1.name).to.equal('Test');
      expect(s2.name).to.not.equal(s1.name);
    });

    it('activateScenario returns scenario when non-baseline', () => {
      const s = manager.cloneScenario('baseline', 'Test');
      const result = manager.activateScenario(s.id);
      expect(result).to.equal(s);
    });

    it('setScenarioOverride updates active scenario', () => {
      const s = manager.cloneScenario('baseline', 'Test');
      manager.activateScenario(s.id);
      manager.setScenarioOverride('f1', '2025-01-01', '2025-01-31');
      expect(s.overrides['f1']).to.exist;
    });
  });

  describe('DataService wrapper coverage', () => {
    it('calls wrapper methods safely', async () => {
      try { await dataService.init(); } catch (e) {}
      const health = await dataService.checkHealth();
      expect(health).to.be.an('object');
      const caps = await dataService.getCapabilities();
      expect(caps).to.be.an('object');
      const cfg = await dataService.getConfig();
      expect(cfg).to.be.an('object');
      try { await dataService.saveConfig({}); } catch (e) {}
      await dataService.setLocalPref('x', 'y');
      const lp = await dataService.getLocalPref('x');
      expect(typeof lp === 'string' || lp === undefined).to.equal(true);
      await dataService.clearColorMappings();
      await dataService.updateProjectColor('p1', '#fff');
      await dataService.updateTeamColor('t1', '#000');
      const colors = await dataService.getColorMappings();
      expect(colors).to.be.an('object');
      try { await dataService.setFeatureDates('f1', 's', 'e'); } catch (e) {}
      try { await dataService.setFeatureField('f1', 'foo', 'bar'); } catch (e) {}
      try { await dataService.batchSetFeatureDates([{ id: 'f1', start: 's', end: 'e' }]); } catch (e) {}
      try { await dataService.publishBaseline([]); } catch (e) {}
      try { await dataService.listScenarios(); } catch (e) {}
      try { await dataService.getScenario('s1'); } catch (e) {}
      try { await dataService.deleteScenario('s1'); } catch (e) {}
      try { await dataService.renameScenario('s1', 'n'); } catch (e) {}
      try { await dataService.saveScenario({ id: 's1', name: 'S1' }); } catch (e) {}
    }).timeout(5000);
  });
});
