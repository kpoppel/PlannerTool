import { expect } from '@open-wc/testing';
import { render } from '../../www/js/vendor/lit.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { renderTaskView } from '../../www/js/plugins/PluginCostTaskView.js';
import { renderTeamView } from '../../www/js/plugins/PluginCostTeamView.js';
import { renderTeamMembersView } from '../../www/js/plugins/PluginCostTeamMembersView.js';
import '../../www/js/plugins/PluginCostComponent.js';

const mockSelectionState = {
  projects: [],
  teams: [],
};

const mockFeatureState = {
  childrenByParent: new Map(),
  effectiveById: new Map(),
};

const mockCmd = vi.hoisted(() => ({
  setSelectedFeature: vi.fn(),
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {
    feature: {
      setSelectedFeature: (feature) => mockCmd.setSelectedFeature(feature),
    },
  },
  sel: {
    selection: {
      getSelectedProjects: () => mockSelectionState.projects,
      getSelectedTeams: () => mockSelectionState.teams,
    },
    feature: {
      getChildrenByParentMap: () => mockFeatureState.childrenByParent,
      getEffectiveFeatureById: (id) => (mockFeatureState.effectiveById.has(id)
        ? mockFeatureState.effectiveById.get(id)
        : null),
    },
    filter: {
      getTaskFilters: () => ({ schedule: { unplanned: true } }),
      getSelectedTaskTypeNames: () => ['Feature'],
    },
  },
}));

describe('PluginCost view rendering', () => {
  afterEach(() => {
    mockSelectionState.projects = [];
    mockSelectionState.teams = [];
    mockFeatureState.childrenByParent = new Map();
    mockFeatureState.effectiveById = new Map();
    mockCmd.setSelectedFeature.mockClear();
  });

  it('renderTaskView shows task table for selected project with metrics', () => {
    mockSelectionState.projects = [{ id: 'p1', name: 'P1', selected: true }];

    const comp = {
      months: [new Date('2026-01-01')],
      startDate: '2026-01-01', endDate: '2026-01-31',
      data: {
        projects: {
          p1: {
            id: 'p1',
            features: [
              {
                id: 't1',
                displayMode: 'normal',
                estimateTeams: { 'team-1': {
                  cost: { internal: { '2026-01': 150 }, external: {} },
                  hours: { internal: { '2026-01': 10 }, external: {} },
                } },
                title: 'Task One',
                project: 'p1',
                start: '2026-01-01',
                end: '2026-01-15',
                capacity: [{ team: 'team-1', capacity: 100 }],
                metrics: {
                  teams: { 'team-1': {
                    cost: { internal: { '2026-01': 150 }, external: {} },
                    hours: { internal: { '2026-01': 10 }, external: {} },
                  } },
                },
              },
              { id: 'old', title: 'BT for F1R1 - CR, defects and maturing 21.19', project: 'p1',
                start: '2025-08-20', end: '2025-11-11', displayMode: 'normal', capacity: [],
                metrics: { teams: {} }, estimateTeams: {} },
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
    expect(html).not.to.include('BT for F1R1');
  });

  it('renders context allocations, empty selected tasks and per-team estimation flags', () => {
    mockSelectionState.projects = [{ id: 'p1', name: 'P1' }];
    mockFeatureState.childrenByParent = new Map([['root', ['leaf', 'empty', 'noise']]]);
    const team = (cost) => ({ cost: { internal: { '2026-01': cost }, external: {} },
      hours: { internal: { '2026-01': cost / 50 }, external: {} } });
    const component = { months: [new Date('2026-01-01')], costTeams: { teams: [] },
      startDate: '2026-01-01', endDate: '2026-01-31',
      data: { projects: { p1: { features: [
        { id: 'root', title: 'Epic', project: 'p1', displayMode: 'normal',
          metrics: { teams: {} }, estimateTeams: { A: team(1000) } },
        { id: 'leaf', title: 'Hidden allocation', project: 'p1', displayMode: 'context',
          metrics: { teams: { A: team(400) } }, estimateTeams: { A: team(400) } },
        { id: 'empty', title: 'Selected empty Feature', project: 'p1', displayMode: 'normal',
          metrics: { teams: {} }, estimateTeams: {} },
        { id: 'noise', title: 'Hidden empty task', project: 'p1', displayMode: 'context',
          metrics: { teams: {} }, estimateTeams: {} },
      ].map((feature) => ({ ...feature, start: '2026-01-01', end: '2026-01-31',
        capacity: Object.keys(feature.estimateTeams).map((team) => ({ team, capacity: 100 })) })) } } } };
    const container = document.createElement('div');
    render(renderTaskView(component), container);
    expect(container.textContent).to.include('Selected empty Feature');
    expect(container.textContent).to.include('No own allocation');
    expect(container.textContent).to.include('Underrun');
    expect(container.textContent).to.include('60');
    expect(container.querySelector('tr.context-row').textContent).to.include('Context');
    expect(container.textContent).not.to.include('Hidden empty task');
  });

  it('renderTeamView shows team table and totals when team selected', () => {
    mockSelectionState.teams = [{ id: 'team-1', name: 'Alpha', selected: true }];
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
    const tpl = renderTeamMembersView({});
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

  it('clicking a task type icon in the task view opens that task', () => {
    mockSelectionState.projects = [{ id: 'p1', name: 'P1', selected: true }];
    const openFeatureDetails = vi.fn();
    const comp = {
      months: [new Date('2026-01-01')],
      startDate: '2026-01-01', endDate: '2026-01-31',
      openFeatureDetails,
      data: {
        projects: {
          p1: {
            id: 'p1',
            features: [
              { id: 't1', type: 'Feature', displayMode: 'normal', title: 'Task One', project: 'p1',
                start: '2026-01-01', end: '2026-01-15', capacity: [],
                metrics: { teams: {} }, estimateTeams: {} },
            ],
          },
        },
      },
      costTeams: { teams: [] },
      _expandedSections: new Set(['project-p1']),
    };

    const container = document.createElement('div');
    render(renderTaskView(comp), container);
    container.querySelector('.type-icon').click();
    expect(openFeatureDetails.mock.calls).to.deep.equal([['t1']]);
  });

  it('clicking a task type icon in the team view opens that task', () => {
    mockSelectionState.teams = [{ id: 'team-1', name: 'Alpha', selected: true }];
    const openFeatureDetails = vi.fn();
    const comp = {
      months: [new Date('2026-01-01')],
      viewMode: 'cost',
      openFeatureDetails,
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

    const container = document.createElement('div');
    render(renderTeamView(comp), container);
    container.querySelector('.type-icon').click();
    expect(openFeatureDetails.mock.calls).to.deep.equal([['f1']]);
  });

  it('openFeatureDetails selects the effective feature so the details panel shows it', () => {
    const feature = { id: 't1', title: 'Task One' };
    mockFeatureState.effectiveById.set('t1', feature);
    const el = document.createElement('plugin-cost');

    el.openFeatureDetails('t1');

    expect(mockCmd.setSelectedFeature.mock.calls).to.deep.equal([[feature]]);
  });

  it('details panel z-index token stacks above the plugin-cost host z-index', () => {
    const mainCss = readFileSync(resolve(process.cwd(), 'www/css/main.css'), 'utf8');
    const componentSource = readFileSync(
      resolve(process.cwd(), 'www/js/plugins/PluginCostComponent.js'),
      'utf8',
    );
    const detailsZ = Number(mainCss.match(/--z-details:\s*(\d+)/)[1]);
    const costHostZ = Number(componentSource.match(/:host\s*\{[^}]*z-index:\s*(\d+)/)[1]);
    expect(detailsZ).to.be.greaterThan(costHostZ);
  });

  it('opening the cost plugin closes an open details panel', () => {
    const el = document.createElement('plugin-cost');
    el._persistPluginState = vi.fn();
    el.loadData = vi.fn();
    el._applySidebarDisabled = vi.fn();
    const panel = document.createElement('details-panel');
    panel.open = true;
    panel.hide = vi.fn();
    document.body.append(panel);

    el.open();

    expect(panel.hide.mock.calls.length).to.equal(1);
    panel.remove();
  });

  it('opening the cost plugin leaves a closed details panel untouched', () => {
    const el = document.createElement('plugin-cost');
    el._persistPluginState = vi.fn();
    el.loadData = vi.fn();
    el._applySidebarDisabled = vi.fn();
    const panel = document.createElement('details-panel');
    panel.open = false;
    panel.hide = vi.fn();
    document.body.append(panel);

    el.open();

    expect(panel.hide.mock.calls.length).to.equal(0);
    panel.remove();
  });
});
