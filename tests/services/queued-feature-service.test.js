import { expect } from '@open-wc/testing';
import { QueuedFeatureService } from '../../www/js/services/QueuedFeatureService.js';
import { computeMoveUpdates } from '../../www/js/components/dragManager.js';
import { featureFlags } from '../../www/js/config.js';

describe('QueuedFeatureService epic-child behavior', () => {
  it('preserves explicit child overrides and shifts non-explicit children when epic moves', (done) => {
    // Setup baseline features: one epic e1 and two children f1 (explicit), f2 (not explicit)
    const features = [
      { id: 'e1', type: 'epic', start: '2025-09-01', end: '2025-09-30' },
      { id: 'f1', type: 'feature', parentEpic: 'e1', start: '2025-09-05', end: '2025-09-10' },
      { id: 'f2', type: 'feature', parentEpic: 'e1', start: '2025-09-12', end: '2025-09-15' }
    ];

    const baselineStore = {
      getFeatures: () => features,
      getFeatureById: () => new Map(features.map(f => [f.id, f]))
    };

    const activeScenario = { overrides: { 'f1': { start: '2025-09-07', end: '2025-09-11' } }, isChanged: false };
    const svc = new QueuedFeatureService(baselineStore, { getActiveScenario: () => activeScenario });
    svc.setChildrenByEpic(new Map([['e1', ['f1','f2']]]));

    // Enable instrumentation
    featureFlags.serviceInstrumentation = true;

    // Capture console logs
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => { logs.push(args); origLog.apply(console, args); };

    // Move epic by +7 days
    const newStart = new Date(2025,8,8); // 2025-09-08
    const newEnd = new Date(2025,9,7); // 2025-10-07 (same duration)
    const updates = computeMoveUpdates(features[0], newStart, newEnd, features);
    svc.updateFeatureDates(updates);

    // Allow queued processing to run (queued has setTimeout fallback)
    setTimeout(()=>{
      try{
        // f1 was explicit and should retain its override
        expect(activeScenario.overrides['f1'].start).to.equal('2025-09-07');
        // f2 was not explicit and should have been shifted by +7 days
        expect(activeScenario.overrides['f2'].start).to.equal('2025-09-19');
        // epic should be updated to include moved child ends if necessary
        // Note: epic start will reflect the earliest child start (explicit override),
        // so expect the earliest child's explicit date
        expect(activeScenario.overrides['e1'].start).to.equal('2025-09-07');
      }finally{
        console.log = origLog;
        done();
      }
    }, 250);
  });
});

describe('QueuedFeatureService resize behavior', () => {
  it('clamps epic resize against children when shrinking', (done) => {
    const features = [
      { id: 'e2', type: 'epic', start: '2025-09-01', end: '2025-09-30' },
      { id: 'f3', type: 'feature', parentEpic: 'e2', start: '2025-09-10', end: '2025-10-05' }
    ];
    const baselineStore = { getFeatures: () => features, getFeatureById: () => new Map(features.map(f => [f.id, f])) };
    const activeScenario = { overrides: {}, isChanged: false };
    const svc = new QueuedFeatureService(baselineStore, { getActiveScenario: () => activeScenario });
    svc.setChildrenByEpic(new Map([['e2', ['f3']]]));

    // Shrink epic to earlier end that would cut off child
    const updates = [{ id: 'e2', start: '2025-09-01', end: '2025-09-15' }];
    svc.updateFeatureDates(updates);
    setTimeout(()=>{
      try{
        // epic end should be clamped to child's effective end (2025-10-05)
        expect(activeScenario.overrides['e2'].end).to.equal('2025-10-05');
      }finally{ done(); }
    }, 250);
  });

  it('feature resize extends parent epic when necessary', (done) => {
    const features = [
      { id: 'e3', type: 'epic', start: '2025-09-01', end: '2025-09-30' },
      { id: 'f4', type: 'feature', parentEpic: 'e3', start: '2025-09-10', end: '2025-09-20' }
    ];
    const baselineStore = { getFeatures: () => features, getFeatureById: () => new Map(features.map(f => [f.id, f])) };
    const activeScenario = { overrides: {}, isChanged: false };
    const svc = new QueuedFeatureService(baselineStore, { getActiveScenario: () => activeScenario });
    svc.setChildrenByEpic(new Map([['e3', ['f4']]]));

    // Extend feature beyond epic end
    const updates = [{ id: 'f4', start: '2025-09-10', end: '2025-10-10' }];
    svc.updateFeatureDates(updates);
    setTimeout(()=>{
      try{
        expect(activeScenario.overrides['e3']).to.exist;
        expect(activeScenario.overrides['e3'].end).to.equal('2025-10-10');
      }finally{ done(); }
    }, 250);
  });
});
