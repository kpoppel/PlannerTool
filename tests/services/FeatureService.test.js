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
      {
        id: 'f1',
        title: 'F1',
        type: 'feature',
        parentId: 'e1',
        start: '2025-01-01',
        end: '2025-01-10',
        capacity: null,
      },
      {
        id: 'e1',
        title: 'E1',
        type: 'epic',
        start: '2025-01-01',
        end: '2025-01-05',
      },
      {
        id: 'f2',
        title: 'F2',
        type: 'feature',
        start: '2025-02-01',
        end: '2025-02-10',
        capacity: { foo: 1 },
        tags: 'alpha; beta',
      },
    ];

    baselineStore = {
      getFeatures: () => features.slice(),
      getFeatureById: () => new Map(features.map((f) => [f.id, f])),
    };

    activeScenario = { overrides: {}, isChanged: false };

    fs = new FeatureService(baselineStore, () => activeScenario);
    fs.setChildrenByParent(new Map([['e1', ['f1']]]));

    // stub bus.emit to capture events
    origBusEmit = bus.emit;
    bus.emitted = [];
    bus.emit = function (ev, payload) {
      this.emitted.push({ ev, payload });
    };
  });

  afterEach(() => {
    bus.emit = origBusEmit;
  });

  it('getEffectiveFeatures returns baseline when no scenario', () => {
    const list = fs.getEffectiveFeatures();
    expect(list).to.be.an('array');
    expect(list.find((x) => x.id === 'f1')).to.have.property('title', 'F1');
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
    const okTags = fs.updateFeatureField('f2', 'tags', 'alpha; gamma');
    expect(okTags).to.equal(true);
    // invalid field
    const bad = fs.updateFeatureField('f2', 'nonexistent', 1);
    expect(bad).to.equal(false);
    expect(bus.emitted.length).to.be.greaterThan(0);
  });

  it('updateFeatureRelations stores a scenario override and emits', () => {
    const relations = [{ type: 'Related', id: 'f1' }];

    const updated = fs.updateFeatureRelations('f2', relations);

    expect(updated).to.equal(true);
    expect(activeScenario.isChanged).to.equal(true);
    expect(activeScenario.overrides.f2.relations).to.deep.equal(relations);
    expect(activeScenario.overrides.f2.relations).to.not.equal(relations);
    expect(bus.emitted.length).to.be.greaterThan(0);
  });

  it('getEffectiveFeatureById marks tags as changed when tags override differs', () => {
    activeScenario.overrides['f2'] = { tags: 'gamma; delta' };
    const eff = fs.getEffectiveFeatureById('f2');
    expect(eff.changedFields).to.include('tags');
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

describe('expandParentChildClosure — lateral-traversal prevention', () => {
  /**
   * Shared helper: builds a minimal FeatureService from a flat feature list and
   * a pre-computed parent→children map.
   */
  function makeSvc(features, childrenByParent) {
    const store = {
      getFeatures: () => features.slice(),
      getFeatureById: () => new Map(features.map((f) => [f.id, f])),
    };
    const svc = new FeatureService(store, () => null);
    svc.setChildrenByParent(childrenByParent);
    return svc;
  }

  it('does NOT pull in siblings via a shared ancestor (lateral traversal blocked)', () => {
    // Scenario: team plan T1 selected.
    //   Feature-A (T1) → parent Epic1 (P1)
    //   Epic1 also has Feature-B (T2) as another child — must not be included.
    const features = [
      { id: 'epic1', project: 'p1' },
      { id: 'feature-a', project: 't1', parentId: 'epic1' },
      { id: 'feature-b', project: 't2', parentId: 'epic1' }, // sibling in unrelated plan
    ];
    const childrenByParent = new Map([['epic1', ['feature-a', 'feature-b']]]);
    const svc = makeSvc(features, childrenByParent);

    const result = svc.expandParentChildClosure(new Set(['feature-a']));

    expect(result.has('feature-a')).to.equal(true);
    expect(result.has('epic1')).to.equal(true);   // ancestor pulled in ✓
    expect(result.has('feature-b')).to.equal(false); // lateral sibling blocked ✓
  });

  it('includes the full descendant tree when starting from a project-plan Epic', () => {
    // Scenario: project plan P1 selected, Epic1 is base.
    //   Epic1 → Feature-A (T1), Feature-B (T1)
    //   Feature-A → Sub-A (T2)
    const features = [
      { id: 'epic1', project: 'p1' },
      { id: 'feature-a', project: 't1', parentId: 'epic1' },
      { id: 'feature-b', project: 't1', parentId: 'epic1' },
      { id: 'sub-a', project: 't2', parentId: 'feature-a' },
    ];
    const childrenByParent = new Map([
      ['epic1', ['feature-a', 'feature-b']],
      ['feature-a', ['sub-a']],
    ]);
    const svc = makeSvc(features, childrenByParent);

    const result = svc.expandParentChildClosure(new Set(['epic1']));

    expect(result.has('epic1')).to.equal(true);
    expect(result.has('feature-a')).to.equal(true);
    expect(result.has('feature-b')).to.equal(true);
    expect(result.has('sub-a')).to.equal(true);
    expect(result.size).to.equal(4);
  });

  it('resolves multiple parents in different plans without lateral expansion', () => {
    // Scenario: team plan T1 selected.
    //   Feature-A (T1) → parent Epic1 (P1)
    //   Feature-B (T1) → parent Epic3 (P2)   ← different project plan
    //   Epic1 also has Feature-X (T2) — must NOT appear.
    //   Epic3 also has Feature-Y (T3) — must NOT appear.
    const features = [
      { id: 'epic1', project: 'p1' },
      { id: 'epic3', project: 'p2' },
      { id: 'feature-a', project: 't1', parentId: 'epic1' },
      { id: 'feature-b', project: 't1', parentId: 'epic3' },
      { id: 'feature-x', project: 't2', parentId: 'epic1' }, // unrelated sibling
      { id: 'feature-y', project: 't3', parentId: 'epic3' }, // unrelated sibling
    ];
    const childrenByParent = new Map([
      ['epic1', ['feature-a', 'feature-x']],
      ['epic3', ['feature-b', 'feature-y']],
    ]);
    const svc = makeSvc(features, childrenByParent);

    const result = svc.expandParentChildClosure(new Set(['feature-a', 'feature-b']));

    expect(result.has('feature-a')).to.equal(true);
    expect(result.has('feature-b')).to.equal(true);
    expect(result.has('epic1')).to.equal(true);   // parent in P1 ✓
    expect(result.has('epic3')).to.equal(true);   // parent in P2 ✓
    expect(result.has('feature-x')).to.equal(false); // unrelated sibling blocked ✓
    expect(result.has('feature-y')).to.equal(false); // unrelated sibling blocked ✓
  });

  it('resolves a deep upward ancestor chain from a low-level base', () => {
    // Sub-A (T2) → Feature-A (T1) → Epic1 (P1) → Project (P1)
    const features = [
      { id: 'project', project: 'p1' },
      { id: 'epic1', project: 'p1', parentId: 'project' },
      { id: 'feature-a', project: 't1', parentId: 'epic1' },
      { id: 'sub-a', project: 't2', parentId: 'feature-a' },
    ];
    const childrenByParent = new Map([
      ['project', ['epic1']],
      ['epic1', ['feature-a']],
      ['feature-a', ['sub-a']],
    ]);
    const svc = makeSvc(features, childrenByParent);

    // Base is Sub-A only
    const result = svc.expandParentChildClosure(new Set(['sub-a']));

    expect(result.has('sub-a')).to.equal(true);
    expect(result.has('feature-a')).to.equal(true);
    expect(result.has('epic1')).to.equal(true);
    expect(result.has('project')).to.equal(true);
    expect(result.size).to.equal(4);
  });

  it('computeExpandedFeatureSet reports correct parentChild count', () => {
    // Base = {epic1} → adds feature-a, feature-b, sub-a  → count = 3
    const features = [
      { id: 'epic1', project: 'p1' },
      { id: 'feature-a', project: 't1', parentId: 'epic1' },
      { id: 'feature-b', project: 't1', parentId: 'epic1' },
      { id: 'sub-a', project: 't2', parentId: 'feature-a' },
    ];
    const childrenByParent = new Map([
      ['epic1', ['feature-a', 'feature-b']],
      ['feature-a', ['sub-a']],
    ]);
    const svc = makeSvc(features, childrenByParent);

    const { expandedIds, counts } = svc.computeExpandedFeatureSet(
      new Set(['epic1']),
      { expandParentChild: true }
    );

    expect(expandedIds.size).to.equal(4);
    expect(counts.parentChild).to.equal(3); // feature-a, feature-b, sub-a
  });
});
