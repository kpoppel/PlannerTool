import { expect } from '@open-wc/testing';
import { FeatureService } from '../../www/js/services/FeatureService.js';
import { state } from '../../www/js/services/State.js';
import { bus } from '../../www/js/core/EventBus.js';
import { FeatureEvents } from '../../www/js/core/EventRegistry.js';

describe('Feature Service and State Oracles (consolidated)', () => {
  describe('FeatureService unit behaviors', () => {
    it('getEffectiveFeatures returns baseline when no active scenario', () => {
      const baselineStore = {
        getFeatures: () => [{ id: 1, title: 'F1' }, { id: 2, title: 'F2' }]
      };
      const svc = new FeatureService(baselineStore, () => null);
      const eff = svc.getEffectiveFeatures();
      expect(eff).to.have.lengthOf(2);
      expect(eff[0].title).to.equal('F1');
    });

    it('getEffectiveFeatures applies overrides and sets dirty flags', () => {
      const baselineStore = { getFeatures: () => [{ id: 10, start: '2025-01-01', end: '2025-01-10', title: 'Base' }], getFeatureById: () => new Map([{ 10: { id: 10, start: '2025-01-01', end: '2025-01-10', title: 'Base' } }]) };
      const activeScenario = { overrides: { 10: { start: '2025-01-02', end: '2025-01-09' } } };
      const svc = new FeatureService(baselineStore, { getActiveScenario: () => activeScenario });
      const eff = svc.getEffectiveFeatures();
      expect(eff[0].scenarioOverride).to.be.true;
      expect(eff[0].dirty).to.be.true;
    });

    it('updateFeatureField sets override for start/end and returns true', () => {
      const baselineStore = { getFeatures: () => [{ id: 5, start: '2025-01-01', end: '2025-01-05' }], getFeatureById: () => new Map([{ 5: { id: 5, start: '2025-01-01', end: '2025-01-05' } }]) };
      const activeScenario = { overrides: {}, isChanged: false };
      const svc = new FeatureService(baselineStore, { getActiveScenario: () => activeScenario });
      const changed = svc.updateFeatureField(5, 'start', '2025-01-02');
      expect(changed).to.be.true;
      expect(activeScenario.overrides[5].start).to.equal('2025-01-02');
    });

    it('revertFeature removes override and returns true', () => {
      const baselineStore = { getFeatures: () => [{ id: 7, start: '2025-01-01', end: '2025-01-05' }], getFeatureById: () => new Map([{ 7: { id: 7, start: '2025-01-01', end: '2025-01-05' } }]) };
      const activeScenario = { overrides: { 7: { start: '2025-01-02', end: '2025-01-06' } }, isChanged: false };
      const svc = new FeatureService(baselineStore, { getActiveScenario: () => activeScenario });
      const res = svc.revertFeature(7);
      expect(res).to.be.true;
      expect(activeScenario.overrides[7]).to.be.undefined;
    });

    it('updateFeatureDates clamps epic end to max child end when shrinking', () => {
      const features = [
        { id: 'e1', type: 'epic', start: '2025-01-01', end: '2025-01-10' },
        { id: 'f1', type: 'feature', parentEpic: 'e1', start: '2025-01-01', end: '2025-01-12' }
      ];
      const baselineStore = {
        getFeatures: () => features,
        getFeatureById: () => new Map(features.map(f => [f.id, f]))
      };
      const activeScenario = { overrides: {}, isChanged: false };
      const svc = new FeatureService(baselineStore, { getActiveScenario: () => activeScenario });
      svc.setChildrenByEpic(new Map([['e1', ['f1']]]));

      const updates = [{ id: 'e1', start: '2025-01-01', end: '2025-01-05' }];
      const count = svc.updateFeatureDates(updates);
      expect(count).to.equal(1);
      expect(activeScenario.overrides['e1'].end).to.equal('2025-01-12');
    });

    it('updateFeatureDates extends parent epic when feature extends beyond epic', () => {
      const features = [
        { id: 'e2', type: 'epic', start: '2025-01-01', end: '2025-01-10' },
        { id: 'f2', type: 'feature', parentEpic: 'e2', start: '2025-01-01', end: '2025-01-08' }
      ];
      const baselineStore = {
        getFeatures: () => features,
        getFeatureById: () => new Map(features.map(f => [f.id, f]))
      };
      const activeScenario = { overrides: {}, isChanged: false };
      const svc = new FeatureService(baselineStore, { getActiveScenario: () => activeScenario });
      svc.setChildrenByEpic(new Map([['e2', ['f2']]]));

      const updates = [{ id: 'f2', start: '2025-01-01', end: '2025-01-15' }];
      const count = svc.updateFeatureDates(updates);
      expect(count).to.equal(1);
      expect(activeScenario.overrides['e2']).to.exist;
      expect(activeScenario.overrides['e2'].end).to.equal('2025-01-15');
    });

    it('getFeatureTitleById returns title or id', () => {
      const baselineStore = { getFeatures: () => [{ id: 99, title: 'NinetyNine' }], getFeatureById: () => new Map([[99, { id: 99, title: 'NinetyNine' }]]) };
      const svc = new FeatureService(baselineStore, () => null);
      expect(svc.getFeatureTitleById(99)).to.equal('NinetyNine');
      expect(svc.getFeatureTitleById(123)).to.equal(123);
    });
  });

  describe('State.js oracle behaviors', () => {
    beforeEach(async () => {
      state.baselineFeatures = [
        { id: 'f1', title: 'Feature 1', type: 'feature', start: '2024-01-01', end: '2024-01-10', team: 't1', project: 'p1', state: 'active' },
        { id: 'f2', title: 'Feature 2', type: 'feature', start: '2024-01-05', end: '2024-01-15', team: 't1', project: 'p1', state: 'active', parentEpic: 'e1' },
        { id: 'e1', title: 'Epic 1', type: 'epic', start: '2024-01-01', end: '2024-01-20', team: 't1', project: 'p1', state: 'active' }
      ];
      state._baselineStore.setFeatures(state.baselineFeatures);
      state._dataInitService.baselineFeatureById = new Map();
      state._dataInitService.childrenByEpic = new Map();
      for (const f of state.baselineFeatures) {
        state._dataInitService.baselineFeatureById.set(f.id, f);
      }
      for (const f of state.baselineFeatures) {
        if (f.type === 'feature' && f.parentEpic) {
          if (!state._dataInitService.childrenByEpic.has(f.parentEpic)) {
            state._dataInitService.childrenByEpic.set(f.parentEpic, []);
          }
          state._dataInitService.childrenByEpic.get(f.parentEpic).push(f.id);
        }
      }
      state._scenarioEventService._scenarios = [ { id: 'test-scenario', name: 'Test', overrides: {}, isChanged: false } ];
      state._scenarioEventService.setActiveScenarioId('test-scenario');
      state._featureService = null;
    });

    it('getEffectiveFeatures returns baseline when no scenario is active', () => {
      state.activeScenarioId = null;
      const features = state.getEffectiveFeatures();
      expect(features).to.have.lengthOf(3);
    });

    it('should apply scenario overrides when scenario is active', () => {
      const scenario = state.scenarios.find(s => s.id === 'test-scenario');
      scenario.overrides['f1'] = { start: '2024-01-02', end: '2024-01-12' };
      const features = state.getEffectiveFeatures();
      const f1 = features.find(f => f.id === 'f1');
      expect(f1.start).to.equal('2024-01-02');
      expect(f1.scenarioOverride).to.be.true;
      expect(f1.dirty).to.be.true;
    });

    it('updateFeatureField marks scenario as changed', () => {
      state.updateFeatureField('f1', 'end', '2024-01-15');
      const scenario = state.scenarios.find(s => s.id === 'test-scenario');
      expect(scenario.overrides['f1']).to.deep.equal({ start: '2024-01-01', end: '2024-01-15' });
    });

    it('updateFeatureDates should emit FeatureEvents.UPDATED', (done) => {
      bus.once(FeatureEvents.UPDATED, () => done());
      const updates = [{ id: 'f1', start: '2024-01-02', end: '2024-01-12' }];
      state.updateFeatureDates(updates);
    });

    it('revertFeature removes override and emits event', (done) => {
      const scenario = state.scenarios.find(s => s.id === 'test-scenario');
      scenario.overrides['f1'] = { start: '2024-01-02', end: '2024-01-12' };
      bus.once(FeatureEvents.UPDATED, () => done());
      state.revertFeature('f1');
    });

    it('getFeatureTitleById returns title or id', () => {
      const title = state.getFeatureTitleById('f1');
      expect(title).to.equal('Feature 1');
      expect(state.getFeatureTitleById('unknown')).to.equal('unknown');
    });
  });
});
