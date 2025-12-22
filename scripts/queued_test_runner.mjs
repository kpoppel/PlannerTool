import { QueuedFeatureService } from '../www/js/services/QueuedFeatureService.js';

// Minimal baseline store mock
const baseline = new Map();
function mkFeature(id, type='feature', start='2025-12-01', end='2025-12-05', parentEpic=null){
  return { id, type, start, end, parentEpic };
}
baseline.set('e1', mkFeature('e1','epic','2025-12-01','2025-12-10'));
baseline.set('f1', mkFeature('f1','feature','2025-12-02','2025-12-04','e1'));
baseline.set('f2', mkFeature('f2','feature','2025-12-03','2025-12-06','e1'));

const baselineStore = {
  getFeatures: ()=>Array.from(baseline.values()),
  getFeatureById: ()=>baseline,
};

let activeScenario = { overrides: {}, isChanged: false };
const scenarioManager = { getActiveScenario: ()=>activeScenario };

const svc = new QueuedFeatureService(baselineStore, scenarioManager.getActiveScenario);
svc.setChildrenByEpic(new Map([['e1',['f1','f2']]]));

(async ()=>{
  console.log('Initial overrides', JSON.stringify(activeScenario.overrides));
  // Move epic by +2 days: shift from 2025-12-01 -> 2025-12-03
  await svc.updateFeatureDates([{ id: 'e1', start: '2025-12-03', end: '2025-12-12' }]);
  // Wait a bit for idle processing to run
  await new Promise(r=>setTimeout(r,200));
  console.log('After epic move overrides', JSON.stringify(activeScenario.overrides, null, 2));
})();
