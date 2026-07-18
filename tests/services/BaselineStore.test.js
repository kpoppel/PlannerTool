import { expect } from '@esm-bundle/chai';
import { BaselineStore } from '../../www/js/services/BaselineStore.js';

describe('BaselineStore', () => {
  it('returns immutable deep copies from legacy getters', () => {
    const store = new BaselineStore();
    store.loadBaseline({
      projects: [{ id: 'p1', meta: { a: 1 } }],
      teams: [{ id: 't1', meta: { b: 2 } }],
      features: [{ id: 'f1', nested: { c: 3 } }],
    });

    const projects = store.getProjects();
    const teams = store.getTeams();
    const features = store.getFeatures();

    projects[0].meta.a = 99;
    teams[0].meta.b = 88;
    features[0].nested.c = 77;

    expect(store.getProjects()[0].meta.a).to.equal(1);
    expect(store.getTeams()[0].meta.b).to.equal(2);
    expect(store.getFeatures()[0].nested.c).to.equal(3);
  });

  it('exposes fast reference getters for hot paths', () => {
    const store = new BaselineStore();
    store.loadBaseline({
      projects: [{ id: 'p1' }],
      teams: [{ id: 't1' }],
      features: [{ id: 'f1' }],
    });

    const projectsRef = store.getProjectsRef();
    const teamsRef = store.getTeamsRef();
    const featuresRef = store.getFeaturesRef();

    expect(projectsRef).to.equal(store.getProjectsRef());
    expect(teamsRef).to.equal(store.getTeamsRef());
    expect(featuresRef).to.equal(store.getFeaturesRef());
  });

  it('keeps feature index in sync after baseline updates', () => {
    const store = new BaselineStore();
    store.loadBaseline({ projects: [], teams: [], features: [{ id: 'f1' }] });

    expect(store.getFeatureById().get('f1')).to.deep.equal({ id: 'f1' });

    store.setFeatures([{ id: 'f2' }]);
    expect(store.getFeatureById().get('f1')).to.equal(undefined);
    expect(store.getFeatureById().get('f2')).to.deep.equal({ id: 'f2' });
  });
});
