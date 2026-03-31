import { expect } from '@open-wc/testing';
import { renderProjectView } from '../../www/js/plugins/PluginCostV2ProjectView.js';
import { state } from '../../www/js/services/State.js';

describe('PluginCostV2 Project View render paths', () => {
  let originalProjects;

  beforeEach(() => {
    // snapshot current projects and replace with controlled test data
    originalProjects = state._projectTeamService.projects.slice();
  });

  afterEach(() => {
    // restore
    state._projectTeamService.projects = originalProjects;
  });

  it('returns an empty-state when no data present', () => {
    const res = renderProjectView({});
    expect(res).to.be.ok;
  });

  it('renders project-level empty table when project selected but no features', () => {
    state._projectTeamService.projects = [{ id: 'p1', name: 'P1', selected: true }];

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
