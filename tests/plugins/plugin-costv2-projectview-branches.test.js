import { expect } from '@open-wc/testing';
import { renderProjectView } from '../../www/js/plugins/PluginCostV2ProjectView.js';
import { render } from '../../www/js/vendor/lit.js';
import { state } from '../../www/js/services/State.js';

function mkFeature(id, teamName, monthKey, costInt = 100, hoursInt = 5) {
  const metrics = {
    teams: {
      [teamName]: {
        cost: { internal: { [monthKey]: costInt }, external: {} },
        hours: { internal: { [monthKey]: hoursInt }, external: {} },
      },
    },
  };
  return { id, title: `F${id}`, metrics };
}

describe('PluginCostV2 Project View deeper branches', () => {
  let originalProjects;
  beforeEach(() => {
    originalProjects =
      state._projectTeamService.projects ?
        state._projectTeamService.projects.slice()
      : [];
    state._projectTeamService.projects = [{ id: 'p1', name: 'P1', selected: true }];
    state._dataInitService.childrenByParent = new Map();
  });
  afterEach(() => {
    state._projectTeamService.projects = originalProjects;
    state._dataInitService.childrenByParent = new Map();
  });

  it('renders team-month table and summary when project has features', () => {
    const comp = {
      months: [new Date('2026-01-01'), new Date('2026-02-01')],
      monthsMap: {},
      expandedProjects: new Set(['p1']),
      projectViewSelection: { p1: 'teams' },
      viewMode: 'cost',
      data: {
        projects: {
          p1: {
            id: 'p1',
            features: [
              mkFeature('f1', 'team-alpha', '2026-01'),
              mkFeature('f2', 'team-beta', '2026-02'),
            ],
            totals: {
              sites: {
                'Site A': { hours: { '2026-01': 2 }, cost: { '2026-01': 50 } },
              },
            },
          },
        },
      },
      costTeams: { teams: [{ id: 'team-alpha', name: 'Alpha' }] },
    };

    const res = renderProjectView(comp);
    expect(res).to.be.ok;
    const container = document.createElement('div');
    render(res, container);
    const htmlStr = container.innerHTML;
    expect(htmlStr).to.include('Team');
    expect(htmlStr).to.include('Sum');
  });

  it('renders feature list when features view selected', () => {
    const comp = {
      months: [new Date('2026-01-01')],
      monthsMap: {},
      expandedProjects: new Set(['p1']),
      projectViewSelection: { p1: 'features' },
      viewMode: 'hours',
      data: {
        projects: {
          p1: {
            id: 'p1',
            features: [mkFeature('f3', 'team-alpha', '2026-01')],
          },
        },
      },
      costTeams: { teams: [{ id: 'team-alpha', name: 'Alpha' }] },
    };

    const res = renderProjectView(comp);
    expect(res).to.be.ok;
    const container = document.createElement('div');
    render(res, container);
    const htmlStr = container.innerHTML;
    expect(htmlStr).to.include('Feature');
    expect(htmlStr).to.include('Ff3');
  });
});
