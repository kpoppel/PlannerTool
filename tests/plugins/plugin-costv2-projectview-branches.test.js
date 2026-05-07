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

  it('feature list Sum column only counts months inside the display window', () => {
    // Feature has server-provided costs for Jan, Feb, Mar.
    // Display window covers only February.  Sum must be 200, not 600.
    const feature = {
      id: 'fx',
      title: 'Multi-month Feature',
      start: '2026-01-01',
      end: '2026-03-31',
      metrics: {
        internal: {
          cost: { '2026-01': 100, '2026-02': 200, '2026-03': 300 },
          hours: { '2026-01': 10, '2026-02': 20, '2026-03': 30 },
        },
        external: { cost: {}, hours: {} },
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
        internal: { cost: { '2026-01': 100 }, hours: {} },
        external: { cost: {}, hours: {} },
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
        internal: { cost: { '2026-01': 50 }, hours: {} },
        external: { cost: {}, hours: {} },
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
        internal: { cost: { '2026-01': 100 }, hours: { '2026-01': 10 } },
        external: { cost: {}, hours: {} },
      },
    };
    const child = {
      id: '101',
      title: 'Feature Child',
      start: '2026-01-01',
      end: '2026-01-31',
      metrics: {
        internal: { cost: { '2026-01': 50 }, hours: { '2026-01': 5 } },
        external: { cost: {}, hours: {} },
      },
    };

    // Establish parent→child relationship in state
    state._dataInitService.childrenByParent = new Map([[100, ['101']]]);

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
        internal: { cost: { '2026-01': 80 }, hours: {} },
        external: { cost: {}, hours: {} },
      },
    };
    const child = {
      id: '201',
      title: 'Indent Child',
      start: '2026-01-01',
      end: '2026-01-31',
      metrics: {
        internal: { cost: { '2026-01': 40 }, hours: {} },
        external: { cost: {}, hours: {} },
      },
    };

    state._dataInitService.childrenByParent = new Map([[200, ['201']]]);

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

  it('rolls up child team cost into parent row (parent own cost is replaced)', () => {
    // Epic has Team A: 500. Child Feature has Team A: 200.
    // Displayed parent sum must be 200 (child), not 500 (own).
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

    const parent = mk('300', 'Epic A', { 'team-alpha': 500 });
    const child = mk('301', 'Feature A', { 'team-alpha': 200 });

    state._dataInitService.childrenByParent = new Map([[300, ['301']]]);

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
    // Epic has Team A: 500 and Team B: 300. Child only has Team A: 200.
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

    const parent = mk('400', 'Epic B', { 'team-alpha': 500, 'team-beta': 300 });
    const child = mk('401', 'Feature B', { 'team-alpha': 200 });

    state._dataInitService.childrenByParent = new Map([[400, ['401']]]);

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
});
