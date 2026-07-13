import { expect } from '@open-wc/testing';
import sinon from 'sinon';
import { renderProjectView } from '../../www/js/plugins/PluginCostProjectView.js';
import { state } from '../../www/js/services/State.js';

describe('PluginCost Project View render paths', () => {
  let projectsStub;

  beforeEach(() => {
    projectsStub = null;
  });

  afterEach(() => {
    projectsStub?.restore();
  });

  it('returns an empty-state when no data present', () => {
    const res = renderProjectView({});
    expect(res).to.be.ok;
  });

  it('renders project-level empty table when project selected but no features', () => {
    projectsStub = sinon
      .stub(state, 'projects')
      .get(() => [{ id: 'p1', name: 'P1', selected: true }]);

    const component = {
      months: [new Date('2026-01-01')],
      monthsMap: {},
      expandedProjects: new Set(),
      projectViewSelection: {},
      data: { projects: { p1: { id: 'p1', features: [] } } },
    };

    const res = renderProjectView(component);
    expect(res).to.be.ok;
  });
});
