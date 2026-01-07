import { expect } from '@esm-bundle/chai';
import { DataInitService } from '../../www/js/services/DataInitService.js';

describe('DataInitService helpers', () => {
  let svc;

  beforeEach(() => {
    // Minimal mocks for constructor dependencies; we only exercise lookup methods
    const bus = { emit: () => {} };
    const dataService = {};
    const baselineStore = {};
    const projectTeamService = {};
    const stateFilterService = {};
    const colorService = {};

    svc = new DataInitService(
      bus,
      dataService,
      baselineStore,
      projectTeamService,
      stateFilterService,
      colorService
    );
  });

  it('builds lookup maps and returns children by epic', () => {
    const features = [
      { id: 'f1', parentEpic: 'e1' },
      { id: 'f2', parentEpic: 'e1' },
      { id: 'f3', parentEpic: 'e2' },
      { id: 'f4' }
    ];

    // call the internal builder
    svc._buildLookupMaps(features);

    // baselineFeatureById should map ids
    expect(svc.getBaselineFeatureById('f1')).to.deep.equal({ id: 'f1', parentEpic: 'e1' });
    expect(svc.getBaselineFeatureById('f4')).to.deep.equal({ id: 'f4' });
    expect(svc.getBaselineFeatureById('missing')).to.equal(undefined);

    // childrenByEpic should return correct arrays
    const e1Children = svc.getChildrenByEpic('e1');
    expect(e1Children).to.be.an('array').that.has.members(['f1', 'f2']);

    const e2Children = svc.getChildrenByEpic('e2');
    expect(e2Children).to.deep.equal(['f3']);

    // non-existing epic returns empty array
    expect(svc.getChildrenByEpic('nope')).to.deep.equal([]);

    // getChildrenByEpicMap returns the underlying Map
    const map = svc.getChildrenByEpicMap();
    expect(map).to.be.instanceOf(Map);
    expect(map.get('e1')).to.deep.equal(['f1', 'f2']);
  });

  it('initState initializes baseline and emits events', async () => {
    const projects = [{ id: 'p1' }];
    const teams = [{ id: 't1' }];
    const features = [{ id: 'f1', status: 'Done' }];

    const bus = { emitted: [], emit(kind, payload) { this.emitted.push({ kind, payload }); } };

    const baselineStore = {
      loadBaseline(obj) { this._projects = obj.projects; this._teams = obj.teams; this._features = obj.features; },
      getProjects() { return this._projects; },
      getTeams() { return this._teams; },
      getFeatures() { return this._features; },
      setFeatures(f) { this._features = f; }
    };

    const projectTeamService = {
      initFromBaseline(p, t) { this._projects = p; this._teams = t; },
      getProjects() { return this._projects; },
      getTeams() { return this._teams; },
      computeFeatureOrgLoad(f) { return 123; }
    };

    const stateFilterService = { setAvailableStates(s) { this.availableFeatureStates = s; }, availableFeatureStates: [] };

    const colorService = { initColors() { return Promise.resolve(); } };

    const dataService = {
      getProjects: async () => projects,
      getTeams: async () => teams,
      getFeatures: async () => features
    };

    svc = new DataInitService(bus, dataService, baselineStore, projectTeamService, stateFilterService, colorService);

    const result = await svc.initState();

    expect(result.baselineProjects).to.equal(projects);
    expect(result.baselineTeams).to.equal(teams);
    expect(result.baselineFeatures[0]).to.include({ id: 'f1', originalRank: 0 });
    // orgLoad should have been added
    expect(result.baselineFeatures[0]).to.have.property('orgLoad', 123);

    // events emitted: at least projects and teams and feature update
    expect(bus.emitted.length).to.be.at.least(3);
  });

  it('refreshBaseline refreshes baseline and emits events', async () => {
    const projects = [{ id: 'p2' }];
    const teams = [{ id: 't2' }];
    const features = [{ id: 'f2', state: 'Open' }];

    const bus = { emitted: [], emit(kind, payload) { this.emitted.push({ kind, payload }); } };

    const baselineStore = {
      loadBaseline(obj) { this._projects = obj.projects; this._teams = obj.teams; this._features = obj.features; },
      getProjects() { return this._projects; },
      getTeams() { return this._teams; },
      getFeatures() { return this._features; },
      setFeatures(f) { this._features = f; }
    };

    const projectTeamService = {
      refreshFromBaseline(p, t) { this._projects = p; this._teams = t; },
      getProjects() { return this._projects; },
      getTeams() { return this._teams; },
      computeFeatureOrgLoad(f) { return 7; }
    };

    const stateFilterService = { setAvailableStates(s) { this.availableFeatureStates = s; }, availableFeatureStates: [] };

    const colorService = { initColors() { return Promise.resolve(); } };

    const dataService = {
      getProjects: async () => projects,
      getTeams: async () => teams,
      getFeatures: async () => features
    };

    svc = new DataInitService(bus, dataService, baselineStore, projectTeamService, stateFilterService, colorService);

    const result = await svc.refreshBaseline();

    expect(result.baselineProjects).to.equal(projects);
    expect(result.baselineTeams).to.equal(teams);
    expect(result.baselineFeatures[0]).to.include({ id: 'f2', originalRank: 0 });
    expect(result.baselineFeatures[0]).to.have.property('orgLoad', 7);

    // Freeze should have been applied (object is frozen)
    expect(Object.isFrozen(result.baselineProjects)).to.be.true;
    expect(Object.isFrozen(result.baselineTeams)).to.be.true;
    expect(Object.isFrozen(result.baselineFeatures)).to.be.true;

    expect(bus.emitted.length).to.be.at.least(2);
  });
});
