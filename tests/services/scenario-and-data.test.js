import { expect } from '@open-wc/testing';
import { EventBus } from '../../www/js/core/EventBus.js';
import { dataService } from '../../www/js/services/dataService.js';

describe('Scenario Manager and DataService (consolidated)', () => {
  describe('DataService wrapper coverage', () => {
    it('calls wrapper methods safely', async () => {
      await dataService.init();
      const health = await dataService.checkHealth();
      expect(health.ok).to.equal(true);
      expect(health).to.be.an('object');
      const cfg = await dataService.getConfig();
      expect(cfg.ok).to.equal(true);
      expect(cfg).to.be.an('object');
      await dataService.saveConfig({});
      await dataService.setLocalPref('x', 'y');
      const lp = await dataService.getLocalPref('x');
      expect(lp.ok).to.equal(true);
      expect(typeof lp.data === 'string' || lp.data === undefined).to.equal(true);
      await dataService.clearColorMappings();
      await dataService.updateProjectColor('p1', '#fff');
      await dataService.updateTeamColor('t1', '#000');
      const colors = await dataService.getColorMappings();
      expect(colors.ok).to.equal(true);
      expect(colors).to.be.an('object');
      const publish = await dataService.publishBaseline([]);
      const listed = await dataService.listScenarios();
      const scenario = await dataService.getScenario('s1');
      const deleted = await dataService.deleteScenario('s1');
      const renamed = await dataService.renameScenario('s1', 'n');
      const saved = await dataService.saveScenario({ id: 's1', name: 'S1' });
      expect(typeof publish.ok).to.equal('boolean');
      expect(typeof listed.ok).to.equal('boolean');
      expect(typeof scenario.ok).to.equal('boolean');
      expect(typeof deleted.ok).to.equal('boolean');
      expect(typeof renamed.ok).to.equal('boolean');
      expect(typeof saved.ok).to.equal('boolean');
    }).timeout(5000);
  });
});
