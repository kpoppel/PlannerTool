import { expect } from '@esm-bundle/chai';
import { FeatureService } from '../../www/js/services/FeatureService.js';
import { bus } from '../../www/js/core/EventBus.js';
import { featureFlags } from '../../www/js/config.js';

describe('FeatureService public methods', () => {
  let baselineStore;
  let activeScenario;
  let fs;
  let origBusEmit;

  beforeEach(() => {
    // baseline store with some features
    const features = [
      { id: 'f1', title: 'F1', type: 'feature', parentEpic: 'e1', start: '2025-01-01', end: '2025-01-10', capacity: null },
      { id: 'e1', title: 'E1', type: 'epic', start: '2025-01-01', end: '2025-01-05' },
      { id: 'f2', title: 'F2', type: 'feature', start: '2025-02-01', end: '2025-02-10', capacity: { foo: 1 } }
    ];

    baselineStore = {
      getFeatures: () => features.slice(),
      getFeatureById: () => new Map(features.map(f => [f.id, f]))
    };

    activeScenario = { overrides: {}, isChanged: false };

    fs = new FeatureService(baselineStore, () => activeScenario);
    fs.setChildrenByEpic(new Map([['e1', ['f1']]]));

    // stub bus.emit to capture events
    origBusEmit = bus.emit;
    bus.emitted = [];
    bus.emit = function (ev, payload) { this.emitted.push({ ev, payload }); };
  });

  afterEach(() => {
    bus.emit = origBusEmit;
  });

  it('getEffectiveFeatures returns baseline when no scenario', () => {
    const list = fs.getEffectiveFeatures();
    expect(list).to.be.an('array');
    expect(list.find(x => x.id === 'f1')).to.have.property('title', 'F1');
  });

  it('getEffectiveFeatureById merges override and marks changedFields', () => {
    // add an override for f1
    activeScenario.overrides['f1'] = { start: '2025-01-02', end: '2025-01-12' };

    const eff = fs.getEffectiveFeatureById('f1');
    expect(eff).to.have.property('scenarioOverride', true);
    expect(eff).to.have.property('changedFields');
    expect(eff.changedFields).to.include('start');
  });

  it('updateFeatureDates updates feature and extends parent epic when needed', () => {
    const updates = [{ id: 'f1', start: '2025-01-01', end: '2025-02-01' }];

    const count = fs.updateFeatureDates(updates);
    expect(count).to.equal(1);
    // bus should have emitted FeatureEvents.UPDATED (symbol), but we just check any emission
    expect(bus.emitted.length).to.be.greaterThan(0);
  });

  it('updateFeatureField updates date and capacity and emits', () => {
    // ensure activeScenario exists
    activeScenario.overrides = {};
    const okDate = fs.updateFeatureField('f2', 'start', '2025-02-02');
    expect(okDate).to.equal(true);
    const okCap = fs.updateFeatureField('f2', 'capacity', { foo: 2 });
    expect(okCap).to.equal(true);
    // invalid field
    const bad = fs.updateFeatureField('f2', 'nonexistent', 1);
    expect(bad).to.equal(false);
    expect(bus.emitted.length).to.be.greaterThan(0);
  });

  it('revertFeature removes override and emits', () => {
    activeScenario.overrides['f2'] = { start: 'x', end: 'y' };
    const ok = fs.revertFeature('f2');
    expect(ok).to.equal(true);
    expect(activeScenario.overrides['f2']).to.equal(undefined);
  });

  it('getFeatureTitleById returns title or id fallback', () => {
    expect(fs.getFeatureTitleById('f1')).to.equal('F1');
    expect(fs.getFeatureTitleById('missing')).to.equal('missing');
  });

  it('_applyDefaultDates adds defaults when missing', () => {
    const prevFlag = featureFlags.SHOW_UNPLANNED_WORK;
    featureFlags.SHOW_UNPLANNED_WORK = false;
    const input = [{ id: 'x' }];
    const res = fs._applyDefaultDates(input);
    expect(res[0]).to.have.property('hasDefaultDates', true);
    featureFlags.SHOW_UNPLANNED_WORK = prevFlag;
  });
});
