import { QueuedFeatureService } from '../www/js/services/QueuedFeatureService.js';

const baseline = new Map();
function mkFeature(id,type,start,end,parentEpic=null){return { id, type, start, end, parentEpic }}
// Epic spans to end 2025-12-31
baseline.set('epicA', mkFeature('epicA','epic','2025-12-01','2025-12-31'));
// Child ends earlier
baseline.set('childA', mkFeature('childA','feature','2025-12-05','2025-12-10','epicA'));

const baselineStore = {
  getFeatures: ()=>Array.from(baseline.values()),
  getFeatureById: ()=>baseline,
};
let activeScenario = { overrides: {}, isChanged: false };
const svc = new QueuedFeatureService(baselineStore, { getActiveScenario: () => activeScenario });
svc.setChildrenByEpic(new Map([['epicA',['childA']]]));

(async ()=>{
  console.log('Initial overrides', JSON.stringify(activeScenario.overrides));
  // Move epic start forward by +4 days (2025-12-01 -> 2025-12-05), keep end same in update
  await svc.updateFeatureDates([{ id: 'epicA', start: '2025-12-05', end: '2025-12-31' }]);
  await new Promise(r=>setTimeout(r,200));
  console.log('After epic move overrides', JSON.stringify(activeScenario.overrides, null, 2));
})();
