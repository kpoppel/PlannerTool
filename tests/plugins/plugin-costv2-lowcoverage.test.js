import { expect } from '@open-wc/testing';
import { render } from '../../www/js/vendor/lit.js';
import { state } from '../../www/js/services/State.js';
import { renderTaskView } from '../../www/js/plugins/PluginCostV2TaskView.js';
import { renderTeamView } from '../../www/js/plugins/PluginCostV2TeamView.js';
import { renderTeamMembersView } from '../../www/js/plugins/PluginCostV2TeamMembersView.js';

describe('PluginCostV2 low-coverage branches', () => {
  afterEach(() => {
    // restore project/team lists
    state._projectTeamService.projects = [];
    state._projectTeamService.teams = [];
  });

  it('renderTaskView shows task table for selected project with metrics', () => {
    state._projectTeamService.projects = [{ id: 'p1', name: 'P1', selected: true }];

    const comp = {
      months: [new Date('2026-01-01')],
      data: {
        projects: {
          p1: {
            id: 'p1',
            features: [
              {
                id: 't1',
                title: 'Task One',
                project: 'p1',
                start: '2026-01-01',
                end: '2026-01-15',
                capacity: [{ team: 'team-1' }],
                metrics: {
                  cost: { internal: { '2026-01': 150 }, external: {} },
                  hours: { internal: { '2026-01': 10 }, external: {} },
                },
              },
            ],
          },
        },
      },
      costTeams: { teams: [{ id: 'team-1', name: 'Alpha' }] },
      _expandedSections: new Set(['project-p1']),
    };

    const tpl = renderTaskView(comp);
    const container = document.createElement('div');
    render(tpl, container);
    const html = container.innerHTML;
    expect(html).to.include('Task');
    expect(html).to.include('Task One');
    expect(html).to.include('150');
    expect(html).to.include('10');
  });

  it('renderTeamView shows team table and totals when team selected', () => {
    state._projectTeamService.teams = [{ id: 'team-1', name: 'Alpha', selected: true }];
    // provide a project with a feature that has server-side team buckets
    const comp = {
      months: [new Date('2026-01-01')],
      viewMode: 'cost',
      data: {
        projects: {
          p1: {
            id: 'p1',
            name: 'P1',
            features: [
              {
                id: 'f1',
                title: 'F1',
                type: 'feature',
                capacity: [{ team: 'team-1', capacity: 1 }],
                metrics: {
                  teams: {
                    'team-1': {
                      cost: { internal: { '2026-01': 200 }, external: {} },
                      hours: { internal: {}, external: {} },
                    },
                  },
                },
              },
            ],
          },
        },
      },
      monthsMap: {},
      _expandedTeams: new Set(['team-team-1']),
    };

    const tpl = renderTeamView(comp);
    const container = document.createElement('div');
    render(tpl, container);
    const html = container.innerHTML;
    expect(html).to.include('Alpha');
    expect(html).to.include('F1');
    expect(html).to.include('200');
  });

  it('renderTeamMembersView handles various shapes and expanded members', () => {
    const comp = { expandedTeams: new Set(['team-A']) };
    // empty/null
    let tpl = renderTeamMembersView({});
    let container = document.createElement('div');
    render(tpl, container);
    expect(container.innerHTML).to.include('No Team Members');

    // array shape
    const comp2 = {
      costTeams: [
        {
          id: 'team-A',
          name: 'Team A',
          totals: { internal_count: 1, external_count: 0, internal_hours_total: 10 },
          members: [
            {
              name: 'Alice',
              site: 'Site A',
              hourly_rate: { parsedValue: 50 },
              hours_per_month: 10,
            },
          ],
        },
      ],
      expandedTeams: new Set(['team-A']),
    };
    container = document.createElement('div');
    render(renderTeamMembersView(comp2), container);
    expect(container.innerHTML).to.include('Team A');
    expect(container.innerHTML).to.include('Alice');

    // object-with-teams shape
    const comp3 = {
      costTeams: { teams: comp2.costTeams },
      expandedTeams: new Set(['team-A']),
    };
    container = document.createElement('div');
    render(renderTeamMembersView(comp3), container);
    expect(container.innerHTML).to.include('Internal Members');
  });
});
