import { expect } from '@open-wc/testing';
import { renderProjectView as renderProjectViewSource } from '../../www/js/plugins/PluginCostProjectView.js';
import { render } from '../../www/js/vendor/lit.js';
import { vi } from 'vitest';

const mockSelectionState = {
  projects: [],
};

const mockFeatureState = {
  childrenByParent: new Map(),
};

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {},
  sel: {
    selection: {
      getSelectedProjects: () => mockSelectionState.projects,
    },
    feature: {
      getChildrenByParentMap: () => mockFeatureState.childrenByParent,
    },
    filter: {
      getTaskFilters: () => ({ schedule: { unplanned: true } }),
      getSelectedTaskTypeNames: () => ['Feature'],
    },
  },
}));

function mkFeature(id, teamName, monthKey, costInt = 100, hoursInt = 5) {
  const metrics = {
    teams: {
      [teamName]: {
        cost: { internal: { [monthKey]: costInt }, external: {} },
        hours: { internal: { [monthKey]: hoursInt }, external: {} },
      },
    },
  };
  return { id, title: `F${id}`, start: '2026-01-01', end: '2026-02-28', metrics };
}

function renderProjectView(component) {
  if (!Object.hasOwn(component, 'costTeams')) {
    component.costTeams = { catalogue: [], teams: {}, groups: {}, suppliers: [] };
  } else if (!Object.hasOwn(component.costTeams, 'catalogue')) {
    component.costTeams = { catalogue: component.costTeams.teams, teams: {}, groups: {}, suppliers: [] };
  }
  if (!Object.hasOwn(component, 'startDate')) {
    component.startDate = component.months[0].toISOString().slice(0, 10);
  }
  if (!Object.hasOwn(component, 'endDate')) {
    const month = component.months[component.months.length - 1];
    component.endDate = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0))
      .toISOString().slice(0, 10);
  }
  for (const project of Object.values(component.data.projects)) {
    for (const feature of project.features) {
      feature.displayMode = 'normal';
      feature.estimateTeams = feature.metrics.teams;
      feature.capacity = Object.keys(feature.estimateTeams).map((team) => ({ team, capacity: 100 }));
      for (const basis of Object.values(feature.metrics.teams)) {
        if (!Object.hasOwn(basis, 'profiles')) {
          basis.profiles = ['internal', 'external'].map((account) => ({
            supplier_id: `fixture-${account}`, profile_id: 'fixture-profile', external: account === 'external',
            fte: 1, cost: basis.cost[account], hours: basis.hours[account],
          }));
          for (const account of ['internal', 'external']) {
            if (!component.costTeams.suppliers.some((entry) => entry.id === `fixture-${account}`)) {
              component.costTeams.suppliers.push({ id: `fixture-${account}`, name: `${account} provider`,
                external: account === 'external', profiles: [{ id: 'fixture-profile', name: 'Standard' }] });
            }
          }
        }
      }
    }
  }
  return renderProjectViewSource(component);
}

describe('PluginCost Project View deeper branches', () => {
  it('renders exact supplier profile costs without combined totals or site apportionment', () => {
    mockSelectionState.projects = [{ id: 'p1', name: 'P1' }];
    const feature = mkFeature('priced', 'A', '2026-01', 600, 20);
    feature.metrics.teams.A.profiles = [
      { supplier_id: 'supplier', profile_id: 'low', external: false, fte: 0.5,
        hours: { '2026-01': 10 }, cost: { '2026-01': 100 } },
      { supplier_id: 'supplier', profile_id: 'high', external: false, fte: 0.5,
        hours: { '2026-01': 10 }, cost: { '2026-01': 500 } },
    ];
    const component = {
      months: [new Date('2026-01-01')], expandedProjects: new Set(['p1']),
      projectViewSelection: { p1: 'teams' }, viewMode: 'cost',
      costTeams: { catalogue: [{ id: 'A', name: 'Alpha', kind: 'team' }], teams: {}, groups: {},
        suppliers: [{ id: 'supplier', name: 'Provider', profiles: [
          { id: 'low', name: 'Low rate' }, { id: 'high', name: 'High rate' },
        ] }] },
      data: { projects: { p1: { id: 'p1', features: [feature] } } },
    };
    const container = document.createElement('div');
    render(renderProjectView(component), container);
    expect(container.textContent).to.include('Provider / Low rate');
    expect(container.textContent).to.include('Provider / High rate');
    const low = [...container.querySelectorAll('tr')].find((row) => row.textContent.includes('Low rate Cost'));
    const high = [...container.querySelectorAll('tr')].find((row) => row.textContent.includes('High rate Cost'));
    expect(low.textContent).to.include('100');
    expect(high.textContent).to.include('500');
    expect(container.textContent).not.to.include('Sum External');
    expect(container.textContent).not.to.include('Site');
  });
  it('omits selected feature rows entirely outside the report dates', () => {
    mockSelectionState.projects = [{ id: 'p1', name: 'P1' }];
    const current = mkFeature('current', 'team-alpha', '2026-01');
    const old = { ...mkFeature('old', 'team-alpha', '2025-08'),
      start: '2025-08-20', end: '2025-11-11' };
    const component = { months: [new Date('2026-01-01')], startDate: '2026-01-01',
      endDate: '2026-12-31', expandedProjects: new Set(['p1']),
      projectViewSelection: { p1: 'features' }, viewMode: 'cost', costTeams: { teams: [] },
      data: { projects: { p1: { id: 'p1', features: [old, current] } } } };
    const container = document.createElement('div');
    render(renderProjectView(component), container);
    expect(container.textContent).to.include('Fcurrent');
    expect(container.textContent).not.to.include('Fold');
  });
  beforeEach(() => {
    mockSelectionState.projects = [{ id: 'p1', name: 'P1', selected: true }];
    mockFeatureState.childrenByParent = new Map();
  });
  afterEach(() => {
    mockSelectionState.projects = [];
    mockFeatureState.childrenByParent = new Map();
  });

  it('preserves selected container order across all plan types', () => {
    mockSelectionState.projects = [
      { id: 'z-root', name: 'Root', type: 'team', container_order: 0 },
      { id: 'm-middle', name: 'Middle', type: 'program', container_order: 1 },
      { id: 'a-leaf', name: 'Leaf', type: 'project', container_order: 2 },
    ];
    const component = {
      months: [new Date('2026-06-01')],
      data: { projects: {} },
    };
    const container = document.createElement('div');
    render(renderProjectView(component), container);
    const headers = Array.from(container.querySelectorAll('.project-header'));
    expect(headers.map((header) => header.textContent.trim()))
      .to.deep.equal(['Root', 'Middle', 'Leaf']);
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

  it('feature list Sum column only counts months inside the display window', () => {
    // Feature has server-provided costs for Jan, Feb, Mar.
    // Display window covers only February.  Sum must be 200, not 600.
    const feature = {
      id: 'fx',
      title: 'Multi-month Feature',
      start: '2026-01-01',
      end: '2026-03-31',
      metrics: {
        teams: {
          'team-alpha': {
            cost: { internal: { '2026-01': 100, '2026-02': 200, '2026-03': 300 }, external: {} },
            hours: { internal: { '2026-01': 10, '2026-02': 20, '2026-03': 30 }, external: {} },
          },
        },
      },
    };

    const comp = {
      months: [new Date('2026-02-01')],
      startDate: '2026-02-01',
      endDate: '2026-02-28',
      expandedProjects: new Set(['p1']),
      projectViewSelection: { p1: 'features' },
      viewMode: 'cost',
      data: { projects: { p1: { id: 'p1', features: [feature] } } },
      costTeams: { teams: [] },
    };

    const res = renderProjectView(comp);
    const container = document.createElement('div');
    render(res, container);
    const sumCells = Array.from(container.querySelectorAll('.sum-column'));
    const sumTexts = sumCells.map((el) => el.textContent.trim());
    expect(sumTexts).to.include('200');
    expect(sumTexts).not.to.include('600');
  });

  it('team month table Sum column only counts months inside the display window', () => {
    // Feature has team costs for Jan, Feb, Mar. Window covers only February.
    const feature = {
      id: 'ft',
      title: 'Team Multi-month',
      start: '2026-01-01',
      end: '2026-03-31',
      metrics: {
        teams: {
          'team-alpha': {
            cost: { internal: { '2026-01': 100, '2026-02': 200, '2026-03': 300 }, external: {} },
            hours: { internal: { '2026-01': 10, '2026-02': 20, '2026-03': 30 }, external: {} },
          },
        },
      },
    };

    const comp = {
      months: [new Date('2026-02-01')],
      startDate: '2026-02-01',
      endDate: '2026-02-28',
      expandedProjects: new Set(['p1']),
      projectViewSelection: { p1: 'teams' },
      viewMode: 'cost',
      data: { projects: { p1: { id: 'p1', features: [feature] } } },
      costTeams: { teams: [{ id: 'team-alpha', name: 'Alpha' }] },
    };

    const res = renderProjectView(comp);
    const container = document.createElement('div');
    render(res, container);
    const sumCells = Array.from(container.querySelectorAll('.sum-column'));
    const sumTexts = sumCells.map((el) => el.textContent.trim());
    // Sum should be 200 (Feb only), not 600 (Jan+Feb+Mar)
    expect(sumTexts).to.include('200');
    expect(sumTexts).not.to.include('600');
  });

  it('shows head and tail clip indicators for features extending outside the display window', () => {
    const feature = {
      id: 'fc',
      title: 'Clipped Feature',
      start: '2025-11-01', // before window start
      end: '2026-03-15',   // after window end
      metrics: {
        teams: { 'team-alpha': {
          cost: { internal: { '2026-01': 100 }, external: {} },
          hours: { internal: {}, external: {} },
        } },
      },
    };

    const comp = {
      months: [new Date('2026-01-01')],
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      expandedProjects: new Set(['p1']),
      projectViewSelection: { p1: 'features' },
      viewMode: 'cost',
      data: { projects: { p1: { id: 'p1', features: [feature] } } },
      costTeams: { teams: [] },
    };

    const res = renderProjectView(comp);
    const container = document.createElement('div');
    render(res, container);
    const htmlStr = container.innerHTML;
    // Both head (◀) and tail (▶) indicators should be present
    expect(htmlStr).to.include('◀');
    expect(htmlStr).to.include('▶');
  });

  it('shows clip warning banner when any feature extends outside the display window', () => {
    const feature = {
      id: 'fb',
      title: 'Banner Feature',
      start: '2025-06-01', // before window
      end: '2026-01-31',
      metrics: {
        teams: { 'team-alpha': {
          cost: { internal: { '2026-01': 50 }, external: {} },
          hours: { internal: {}, external: {} },
        } },
      },
    };

    const comp = {
      months: [new Date('2026-01-01')],
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      expandedProjects: new Set(['p1']),
      projectViewSelection: {},
      viewMode: 'cost',
      data: { projects: { p1: { id: 'p1', features: [feature] } } },
      costTeams: { teams: [] },
    };

    const res = renderProjectView(comp);
    const container = document.createElement('div');
    render(res, container);
    const htmlStr = container.innerHTML;
    // Warning banner about features outside window should appear
    expect(htmlStr).to.include('⚠');
    expect(htmlStr).to.include('display period');
  });

  it('renders children below their parent in the feature list', () => {
    const parent = {
      id: '100',
      title: 'Epic Parent',
      start: '2026-01-01',
      end: '2026-01-31',
      metrics: {
        teams: {},
      },
    };
    const child = {
      id: '101',
      title: 'Feature Child',
      start: '2026-01-01',
      end: '2026-01-31',
      metrics: {
        teams: { 'team-alpha': {
          cost: { internal: { '2026-01': 50 }, external: {} },
          hours: { internal: { '2026-01': 5 }, external: {} },
        } },
      },
    };

    // Establish parent→child relationship for selector seam.
    mockFeatureState.childrenByParent = new Map([[100, ['101']]]);

    const comp = {
      months: [new Date('2026-01-01')],
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      expandedProjects: new Set(['p1']),
      projectViewSelection: { p1: 'features' },
      viewMode: 'cost',
      data: { projects: { p1: { id: 'p1', features: [parent, child] } } },
      costTeams: { teams: [] },
    };

    const res = renderProjectView(comp);
    const container = document.createElement('div');
    render(res, container);
    const htmlStr = container.innerHTML;

    // Parent must appear before child in the rendered output
    const parentPos = htmlStr.indexOf('Epic Parent');
    const childPos = htmlStr.indexOf('Feature Child');
    expect(parentPos).to.be.greaterThan(-1);
    expect(childPos).to.be.greaterThan(-1);
    expect(parentPos).to.be.lessThan(childPos);
  });

  it('indents children more than parents in the feature list', () => {
    const parent = {
      id: '200',
      title: 'Indent Parent',
      start: '2026-01-01',
      end: '2026-01-31',
      metrics: {
        teams: {},
      },
    };
    const child = {
      id: '201',
      title: 'Indent Child',
      start: '2026-01-01',
      end: '2026-01-31',
      metrics: {
        teams: { 'team-alpha': {
          cost: { internal: { '2026-01': 40 }, external: {} },
          hours: { internal: {}, external: {} },
        } },
      },
    };

    mockFeatureState.childrenByParent = new Map([[200, ['201']]]);

    const comp = {
      months: [new Date('2026-01-01')],
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      expandedProjects: new Set(['p1']),
      projectViewSelection: { p1: 'features' },
      viewMode: 'cost',
      data: { projects: { p1: { id: 'p1', features: [parent, child] } } },
      costTeams: { teams: [] },
    };

    const res = renderProjectView(comp);
    const container = document.createElement('div');
    render(res, container);

    // Title cells in each feature row (identified by the data-depth attribute)
    const titleCells = Array.from(container.querySelectorAll('td[data-depth]'));
    expect(titleCells.length).to.be.greaterThan(1);

    // Extract depth values from data-depth attribute
    const paddings = titleCells.map((td) => parseInt(td.getAttribute('data-depth') || '0', 10));

    // Child (second row) must have strictly greater indentation than parent (first row)
    expect(paddings[1]).to.be.greaterThan(paddings[0]);
  });

  // ---- Rollup tests ----

  it('rolls up child team cost after the server suppresses parent allocation', () => {
    // The server has already removed the Epic's Team A reservation.
    const mk = (id, title, teams) => ({
      id: String(id),
      title,
      start: '2026-01-01',
      end: '2026-01-31',
      metrics: {
        teams: Object.fromEntries(
          Object.entries(teams).map(([t, c]) => [
            t,
            {
              cost: { internal: { '2026-01': c }, external: {} },
              hours: { internal: {}, external: {} },
            },
          ])
        ),
      },
    });

    const parent = mk('300', 'Epic A', {});
    const child = mk('301', 'Feature A', { 'team-alpha': 200 });

    mockFeatureState.childrenByParent = new Map([[300, ['301']]]);

    const comp = {
      months: [new Date('2026-01-01')],
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      expandedProjects: new Set(['p1']),
      projectViewSelection: { p1: 'features' },
      viewMode: 'cost',
      data: { projects: { p1: { id: 'p1', features: [parent, child] } } },
      costTeams: { teams: [] },
    };

    const res = renderProjectView(comp);
    const container = document.createElement('div');
    render(res, container);

    const featureRows = Array.from(container.querySelectorAll('tbody tr')).filter((r) =>
      r.querySelector('td[data-depth]')
    );
    expect(featureRows.length).to.equal(2);
    const sums = featureRows.map(
      (r) => r.querySelector('.sum-column') && r.querySelector('.sum-column').textContent.trim()
    );
    expect(sums[0]).to.equal('200'); // parent rolled up from child, not own 500
    expect(sums[1]).to.equal('200'); // child own
  });

  it('keeps own allocation for teams not covered by any child', () => {
    // Epic's resolved metrics retain Team B: 300. Child has Team A: 200.
    // Parent displayed sum = Team A (child) 200 + Team B (own) 300 = 500.
    const mk = (id, title, teams) => ({
      id: String(id),
      title,
      start: '2026-01-01',
      end: '2026-01-31',
      metrics: {
        teams: Object.fromEntries(
          Object.entries(teams).map(([t, c]) => [
            t,
            {
              cost: { internal: { '2026-01': c }, external: {} },
              hours: { internal: {}, external: {} },
            },
          ])
        ),
      },
    });

    const parent = mk('400', 'Epic B', { 'team-beta': 300 });
    const child = mk('401', 'Feature B', { 'team-alpha': 200 });

    mockFeatureState.childrenByParent = new Map([[400, ['401']]]);

    const comp = {
      months: [new Date('2026-01-01')],
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      expandedProjects: new Set(['p1']),
      projectViewSelection: { p1: 'features' },
      viewMode: 'cost',
      data: { projects: { p1: { id: 'p1', features: [parent, child] } } },
      costTeams: { teams: [] },
    };

    const res = renderProjectView(comp);
    const container = document.createElement('div');
    render(res, container);

    const featureRows = Array.from(container.querySelectorAll('tbody tr')).filter((r) =>
      r.querySelector('td[data-depth]')
    );
    expect(featureRows.length).to.equal(2);
    const sums = featureRows.map(
      (r) => r.querySelector('.sum-column') && r.querySelector('.sum-column').textContent.trim()
    );
    expect(sums[0]).to.equal('500'); // 200 (Team A from child) + 300 (Team B own)
    expect(sums[1]).to.equal('200'); // child own
  });

  // ---- Project summary / team-month table rollup tests ----

  function mkMultiTeamFeature(id, title, teamsObj) {
    // teamsObj: { teamName: costInternalValue }
    return {
      id: String(id),
      title,
      start: '2026-01-01',
      end: '2026-01-31',
      metrics: {
        teams: Object.fromEntries(
          Object.entries(teamsObj).map(([t, c]) => [
            t,
            {
              cost: { internal: { '2026-01': c }, external: {} },
              hours: { internal: { '2026-01': c / 10 }, external: {} },
            },
          ])
        ),
      },
    };
  }

  function renderTeamsView(features, parentId, childIds) {
    mockFeatureState.childrenByParent = new Map([[parentId, childIds.map(String)]]);
    return {
      months: [new Date('2026-01-01')],
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      expandedProjects: new Set(['p1']),
      projectViewSelection: { p1: 'teams' },
      viewMode: 'cost',
      data: { projects: { p1: { id: 'p1', features } } },
      costTeams: { teams: [] },
    };
  }

  it('team table: Team A shows child value when child covers it (no double-count)', () => {
    // Resolved Epic: Team B 300. Child: Team A 200.
    // Expected Team A total = 200 (child), Team B total = 300 (own).
    const parent = mkMultiTeamFeature(500, 'Epic', { 'team-beta': 300 });
    const child = mkMultiTeamFeature(501, 'Feature', { 'team-alpha': 200 });

    const comp = renderTeamsView([parent, child], 500, [501]);
    const res = renderProjectView(comp);
    const container = document.createElement('div');
    render(res, container);

    const rows = Array.from(container.querySelectorAll('tbody tr')).filter(
      (r) => r.cells && r.cells.length > 1 && !r.classList.contains('totals-row')
    );
    // Collect text from first numeric cell per row as the per-month value
    const teamRows = rows.filter((r) => r.querySelector('td.team-header'));
    const teamNames = teamRows.map((r) => r.querySelector('td.team-header').textContent.trim());
    const teamValues = teamRows.map((r) => {
      const numCells = r.querySelectorAll('td.numeric');
      return numCells[0] ? numCells[0].textContent.trim() : '0';
    });

    const alphaIdx = teamNames.findIndex((n) => n.toLowerCase().includes('alpha'));
    const betaIdx = teamNames.findIndex((n) => n.toLowerCase().includes('beta'));

    expect(alphaIdx, 'team-alpha row not found').to.be.greaterThan(-1);
    expect(betaIdx, 'team-beta row not found').to.be.greaterThan(-1);

    // Team Alpha: child's 200, not parent's 500
    expect(teamValues[alphaIdx]).to.equal('200');
    // Team Beta: parent own 300 (no child covers it)
    expect(teamValues[betaIdx]).to.equal('300');
  });

  it('team table: no double-counting when parent has no children', () => {
    // Single leaf feature: Team A 400. Should be 400.
    const leaf = mkMultiTeamFeature(600, 'Leaf', { 'team-alpha': 400 });
    mockFeatureState.childrenByParent = new Map();

    const comp = {
      months: [new Date('2026-01-01')],
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      expandedProjects: new Set(['p1']),
      projectViewSelection: { p1: 'teams' },
      viewMode: 'cost',
      data: { projects: { p1: { id: 'p1', features: [leaf] } } },
      costTeams: { teams: [] },
    };

    const res = renderProjectView(comp);
    const container = document.createElement('div');
    render(res, container);

    const teamRows = Array.from(container.querySelectorAll('tbody tr')).filter((r) =>
      r.querySelector('td.team-header')
    );
    expect(teamRows.length).to.equal(1);
    const numCells = teamRows[0].querySelectorAll('td.numeric');
    // First numeric cell = Jan 2026 internal = 400
    expect(numCells[0].textContent.trim()).to.equal('400');
  });

  it('project summary Internal Cost matches rollup without double-counting', () => {
    // Resolved Epic has no own Team A metrics. Child: Team A 200.
    const parent = mkMultiTeamFeature(700, 'Epic', {});
    const child = mkMultiTeamFeature(701, 'Feature', { 'team-alpha': 200 });

    const comp = renderTeamsView([parent, child], 700, [701]);
    const res = renderProjectView(comp);
    const container = document.createElement('div');
    render(res, container);

    // Verify the separate internal accounting post.
    const summaryTable = container.querySelector('.summary-table');
    expect(summaryTable, 'summary-table not found').to.be.ok;

    const rows = Array.from(summaryTable.querySelectorAll('tbody tr'));
    const costRow = rows.find(
      (row) => row.querySelector('td').textContent.trim() === 'Internal Cost'
    );
    expect(costRow, 'Cost row not found in summary table').to.be.ok;

    const sumCell = costRow.querySelector('td.sum-column');
    expect(sumCell, 'sum-column not found').to.be.ok;
    // Must be 200 (child), not 700 (parent 500 + child 200)
    expect(sumCell.textContent.trim()).to.equal('200');
  });

  it('summary profile rows retain an ancestor team not covered by its child', () => {
    // Epic has Team A (ERL team). Child has Team B (LY team).
    // Old logic: skips parent entirely → ERL = 0 (wrong).
    // New logic: parent's Team A has no child covering it → kept → ERL = parent's hours.
    const parent = mkMultiTeamFeature(800, 'Epic', { 'team-alpha': 400 });
    const child = mkMultiTeamFeature(801, 'Feature', { 'team-beta': 200 });

    mockFeatureState.childrenByParent = new Map([[800, ['801']]]);

    const comp = {
      months: [new Date('2026-01-01')],
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      expandedProjects: new Set(['p1']),
      projectViewSelection: {},
      viewMode: 'cost',
      data: {
        projects: {
          p1: {
            id: 'p1',
            features: [parent, child],
          },
        },
      },
      costTeams: {
        catalogue: [{ id: 'team-alpha', name: 'Team Alpha' }, { id: 'team-beta', name: 'Team Beta' }],
        teams: {}, groups: {}, suppliers: [],
      },
    };

    const res = renderProjectView(comp);
    const container = document.createElement('div');
    render(res, container);

    const summaryTable = container.querySelector('.summary-table');
    expect(summaryTable, 'summary-table not found').to.be.ok;
    const rows = Array.from(summaryTable.querySelectorAll('tbody tr'));

    // The supplier profile retains the uncovered ancestor's contribution.
    const erlHoursRow = rows.find(
      (row) => row.querySelector('td').textContent.trim() === 'internal provider / Standard Hours'
    );
    expect(erlHoursRow, 'ERL Hours row not found').to.be.ok;
    const erlHoursSum = erlHoursRow.querySelector('td.sum-column');
    expect(erlHoursSum, 'ERL Hours sum-column not found').to.be.ok;
    // team-alpha (ERL, 400h) is kept from parent since no child covers it
    expect(Number(erlHoursSum.textContent.trim())).to.be.greaterThan(0);
  });
});
