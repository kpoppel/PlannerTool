import { expect } from '@esm-bundle/chai';
import { QueuedFeatureService } from '../../www/js/services/QueuedFeatureService.js';
import { bus } from '../../www/js/core/EventBus.js';

describe('QueuedFeatureService basic behavior', () => {
  let baselineStore;
  let activeScenario;
  let qfs;
  let origRequestIdle;
  let origBusEmit;

  beforeEach(() => {
    const features = [
      { id: 'f1', title: 'F1', type: 'feature', parentEpic: 'e1', start: '2025-01-01', end: '2025-01-10' },
      { id: 'e1', title: 'E1', type: 'epic', start: '2025-01-01', end: '2025-01-05' },
      { id: 'f2', title: 'F2', type: 'feature', start: '2025-02-01', end: '2025-02-10', capacity: { a: 1 } }
    ];

    baselineStore = {
      getFeatures: () => features.slice(),
      getFeatureById: () => new Map(features.map(f => [f.id, f]))
    };

    // start with no active scenario to assert false path
    activeScenario = null;

    qfs = new QueuedFeatureService(baselineStore, () => activeScenario);
    qfs.setChildrenByEpic(new Map([['e1', ['f1']]]));

    // stub bus.emit to capture
    origBusEmit = bus.emit;
    bus.emitted = [];
    bus.emit = function (ev, payload) { this.emitted.push({ ev, payload }); };

    // force requestIdleCallback to run synchronously for tests
    origRequestIdle = globalThis.requestIdleCallback;
    globalThis.requestIdleCallback = (cb) => { cb(); };
  });

  afterEach(() => {
    bus.emit = origBusEmit;
    globalThis.requestIdleCallback = origRequestIdle;
  });

  it('getEffectiveFeatures mirrors baseline when no scenario', () => {
    const list = qfs.getEffectiveFeatures();
    expect(list).to.be.an('array');
    expect(list.find(x => x.id === 'f1')).to.have.property('title', 'F1');
  });

  it('_recomputeDerived detects changed fields', () => {
    const base = { id: 'x', start: '2025-01-01', end: '2025-01-10', capacity: { a: 1 } };
    const override = { start: '2025-01-02', capacity: { a: 2 } };
    const res = qfs._recomputeDerived(base, override);
    expect(res.changedFields).to.include.members(['start', 'capacity']);
    expect(res.dirty).to.equal(true);
  });

  it('updateFeatureField updates dates and capacity and emits', () => {
    const ok = qfs.updateFeatureField('f2', 'start', '2025-02-02');
    expect(ok).to.equal(false, 'no active scenario -> false');

    // attach activeScenario and try again
    activeScenario = { overrides: {} };
    const ok2 = qfs.updateFeatureField('f2', 'start', '2025-02-02');
    expect(ok2).to.equal(true);
    expect(bus.emitted.length).to.be.greaterThan(0);
    const ok3 = qfs.updateFeatureField('f2', 'capacity', { a: 3 });
    expect(ok3).to.equal(true);
  });

  it('revertFeature removes overrides and emits', () => {
    activeScenario = { overrides: { 'f1': { start: 'x', end: 'y' } } };
    const ok = qfs.revertFeature('f1');
    expect(ok).to.equal(true);
    expect(activeScenario.overrides['f1']).to.equal(undefined);
  });

  it('updateFeatureDates queues and processes updates', (done) => {
    activeScenario = { overrides: {} };
    // schedule an update for f1 (epic child handling)
    const updates = [{ id: 'e1', start: '2025-01-05', end: '2025-01-20', fromEpicMove: true }];
    const count = qfs.updateFeatureDates(updates, () => {
      // capacity callback invoked asynchronously; ensure overrides applied
      try {
        expect(activeScenario.overrides['e1']).to.exist;
        expect(bus.emitted.length).to.be.greaterThan(0);
        done();
      } catch (e) { done(e); }
    });
    expect(count).to.equal(1);
  });
});
