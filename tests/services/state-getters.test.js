import { expect } from '@esm-bundle/chai';
import sinon from 'sinon';
import { state } from '../../www/js/services/State.js';

describe('State getters coverage small', () => {
  it('invokes simple getters without side-effects', async () => {
    const col = state.getFeatureStateColor('Done');
    expect(col).to.be.a('string');

    const projCol = state.getProjectColor('p1');
    expect(projCol).to.be.a('string');

    const colors = state.getFeatureStateColors();
    expect(colors).to.be.an('object');

    const load = state.computeFeatureOrgLoad({ id: 'f1', teams: [] });
    expect(load).to.be.a('string');
  });

  it('getIterationsForProject resolves only through project.id -> iteration_uuid', () => {
    const projectsStub = sinon.stub(state, 'projects').get(() => ([
      { id: 'cfg-1', name: 'Project A', iteration_uuid: 'set-a' },
    ]));
    const setsStub = sinon.stub(state, 'iterationSetsById').get(() => ({
      'set-a': {
        id: 'set-a',
        name: 'Set A',
        iterations: [{ path: 'SW\\Iteration\\FitXP', name: 'FitXP' }],
      },
    }));

    const byId = state.getIterationsForProject('cfg-1');
    const byName = state.getIterationsForProject('Project A');
    const bySource = state.getIterationsForProject('SW');

    expect(byId).to.have.length(1);
    expect(byName).to.have.length(0);
    expect(bySource).to.have.length(0);

    setsStub.restore();
    projectsStub.restore();
  });

  it('getIterationsForProject can resolve via project iteration_uuid association', () => {
    const projectsStub = sinon.stub(state, 'projects').get(() => ([
      { id: 'cfg-1', name: 'Project A', iteration_uuid: 'set-b' },
    ]));
    const setsStub = sinon.stub(state, 'iterationSetsById').get(() => ({
      'set-b': {
        id: 'set-b',
        name: 'Set B',
        iterations: [{ path: 'SW\\Iteration\\Sprint B', name: 'Sprint B' }],
      },
    }));

    const resolved = state.getIterationsForProject('cfg-1');
    expect(resolved).to.have.length(1);
    expect(resolved[0].name).to.equal('Sprint B');

    setsStub.restore();
    projectsStub.restore();
  });
});
