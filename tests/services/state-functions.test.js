import { expect } from '@esm-bundle/chai';
import { state, PALETTE } from '../../www/js/services/State.js';
import { dataService } from '../../www/js/services/dataService.js';
import { featureFlags } from '../../www/js/config.js';

describe('State small function coverage', () => {
  it('recomputeDerived detects changed fields', () => {
    const base = { start: '2020-01-01', end: '2020-02-01' };
    const res1 = state.recomputeDerived(base, null);
    expect(res1.dirty).to.equal(false);
    const res2 = state.recomputeDerived(base, { start: '2020-01-02' });
    expect(res2.changedFields).to.include('start');
    expect(res2.dirty).to.equal(true);
  });

  it('captureCurrentFilters and captureCurrentView return current selections', () => {
    state._projectTeamService.initFromBaseline(
      [{ id: 'p1' }, { id: 'p2' }],
      [{ id: 't1' }, { id: 't2' }]
    );
    state.setProjectSelected('p1', true);
    state.setTeamSelected('t2', true);
    const filters = state.captureCurrentFilters();
    expect(filters.projects).to.deep.equal(['p1']);
    expect(filters.teams).to.deep.equal(['t2']);

    state._viewService._capacityViewMode = 'project';
    state._viewService._displayMode = 'compact'; // formerly _condensedCards = true
    state._viewService._featureSortMode = 'date';
    const view = state.captureCurrentView();
    expect(view.capacityViewMode).to.equal('project');
    expect(view.condensedCards).to.equal(true);
    expect(view.displayMode).to.equal('compact');
    expect(view.featureSortMode).to.equal('date');
  });

  it('setStateFilter, toggleStateSelected, setAllStatesSelected behave', () => {
    state._stateFilterService.setAvailableStates(['Open', 'Done']);
    state._stateFilterService.toggleStateSelected('Open'); // Start with Open selected
    state.setStateFilter(null);
    expect(Array.from(state.selectedFeatureStateFilter)).to.include.members([
      'Open',
      'Done',
    ]);
    state.setStateFilter('Done');
    expect(Array.from(state.selectedFeatureStateFilter)).to.deep.equal(['Done']);

    state.toggleStateSelected('Done');
    expect(state.selectedFeatureStateFilter.size).to.equal(0);
    state.setAllStatesSelected(true);
    expect(state.selectedFeatureStateFilter.size).to.be.at.least(1);
    state.setAllStatesSelected(false);
    expect(state.selectedFeatureStateFilter.size).to.equal(0);
  });

  it('computeFeatureOrgLoad computes percentage based on selected teams', () => {
    state._projectTeamService.initFromBaseline([], [{ id: 't1' }, { id: 't2' }]);
    state.setTeamSelected('t1', true);
    const feature = {
      capacity: [
        { team: 't1', capacity: 50 },
        { team: 't2', capacity: 50 },
      ],
    };
    const pct = state.computeFeatureOrgLoad(feature);
    expect(pct).to.be.a('string');
    expect(pct.endsWith('%')).to.equal(true);
  });

  it('set and toggle display and modes update properties', () => {
    state.setTimelineScale('weeks');
    expect(state.timelineScale).to.equal('weeks');
    state.setShowEpics(false);
    expect(state.showEpics).to.equal(false);
    state.setShowFeatures(false);
    expect(state.showFeatures).to.equal(false);
    state.setCondensedCards(false);
    expect(state.condensedCards).to.equal(false);
    state.setShowDependencies(true);
    expect(state.showDependencies).to.equal(true);
    state.setCapacityViewMode('team');
    expect(state.capacityViewMode).to.equal('team');
    state.setFeatureSortMode('rank');
    expect(state.featureSortMode).to.equal('rank');
    // invalid modes should be ignored
    state.setCapacityViewMode('invalid');
    expect(['team', 'project']).to.include(state.capacityViewMode);
    state.setFeatureSortMode('invalid');
    expect(['date', 'rank']).to.include(state.featureSortMode);
  });

  it('initColors assigns palette colors when provider returns empty mappings', async () => {
    // Temporarily stub dataService.getColorMappings
    const orig = dataService.getColorMappings;
    dataService.getColorMappings = async () => ({
      projectColors: {},
      teamColors: {},
    });
    // seed projects/teams
    state._projectTeamService.initFromBaseline(
      [{ id: 'pp1' }, { id: 'pp2' }],
      [{ id: 'tt1' }, { id: 'tt2' }, { id: 'tt3' }]
    );
    await state.initColors();
    expect(state.projects[0].color).to.match(/^#/);
    expect(state.teams[2].color).to.match(/^#/);
    dataService.getColorMappings = orig;
  }).timeout(2000);

  it('recomputeCapacityMetrics clears metrics on empty selections', () => {
    state.baselineTeams = [];
    state.baselineProjects = [];
    state._projectTeamService.initFromBaseline([{ id: 'p1' }], [{ id: 't1' }]);
    state._stateFilterService._selectedStates = new Set();
    state.recomputeCapacityMetrics();
    expect(Array.isArray(state.capacityDates)).to.equal(true);
  });

  it('recomputeCapacityMetrics passes all project IDs to calculator when GRAPH_ONLY_SELECTED_PLANS is false', () => {
    // Setup: p1 selected, p2 NOT selected
    state._projectTeamService.initFromBaseline(
      [{ id: 'p1', type: 'project' }, { id: 'p2', type: 'project' }],
      [{ id: 't1', color: '#aabbcc' }]
    );
    state.setProjectSelected('p1', true);
    state.setProjectSelected('p2', false);
    state.setTeamSelected('t1', true);
    state._stateFilterService._selectedFeatureStateFilter = new Set(['active']);

    const calc = state._capacityCalculator;
    const origCalculate = calc.calculate.bind(calc);
    const capturedFilters = [];
    calc.calculate = (features, filters, teams, projects, changed) => {
      capturedFilters.push({ ...filters, selectedProjects: [...filters.selectedProjects] });
      return calc._emptyResult();
    };

    try {
      featureFlags.GRAPH_ONLY_SELECTED_PLANS = false;
      state.recomputeCapacityMetrics();
      const allPlansProjects = capturedFilters[0]?.selectedProjects ?? [];

      capturedFilters.length = 0;
      featureFlags.GRAPH_ONLY_SELECTED_PLANS = true;
      state.recomputeCapacityMetrics();
      const selectedOnlyProjects = capturedFilters[0]?.selectedProjects ?? [];

      // All-plans mode: both projects passed to calculator
      expect(allPlansProjects).to.include('p1');
      expect(allPlansProjects).to.include('p2');
      // Selected-only mode: only p1 (the selected project) passed
      expect(selectedOnlyProjects).to.include('p1');
      expect(selectedOnlyProjects).to.not.include('p2');
    } finally {
      calc.calculate = origCalculate;
      featureFlags.GRAPH_ONLY_SELECTED_PLANS = false;
    }
  });

  describe('getEffectiveSelectedProjectIds', () => {
    it('returns raw selected project IDs when expandTeamAllocated is off', () => {
      state._projectTeamService.initFromBaseline(
        [{ id: 'p1' }, { id: 'p2' }],
        [{ id: 't1' }]
      );
      state.setProjectSelected('p1', true);
      state.setProjectSelected('p2', false);
      state.setExpansionState({ expandTeamAllocated: false });
      const ids = state.getEffectiveSelectedProjectIds();
      expect(ids).to.deep.equal(['p1']);
    });

    it('includes projects from team-allocated features when expandTeamAllocated is on', () => {
      // Setup: p1 selected, p2 not selected; t1 selected
      // Feature f2 belongs to p2 but is allocated to t1
      state._projectTeamService.initFromBaseline(
        [{ id: 'p1' }, { id: 'p2' }],
        [{ id: 't1' }]
      );
      state.setProjectSelected('p1', true);
      state.setProjectSelected('p2', false);
      state.setTeamSelected('t1', true);

      // Stub featureService.expandTeamAllocated and getEffectiveFeatures
      const origFS = state._featureService;
      state._featureService = {
        expandTeamAllocated: (teamIds) => new Set(['f2']),
        getEffectiveFeatures: () => [
          { id: 'f1', project: 'p1', capacity: [] },
          { id: 'f2', project: 'p2', capacity: [{ team: 't1', capacity: 1 }] },
        ],
      };

      state._expansionState.expandTeamAllocated = true;
      const ids = state.getEffectiveSelectedProjectIds();
      state._featureService = origFS;

      // p2 must be included because f2 is allocated to the selected team t1
      expect(new Set(ids)).to.deep.equal(new Set(['p1', 'p2']));
    });

    it('returns only raw selected IDs when no teams are selected', () => {
      state._projectTeamService.initFromBaseline(
        [{ id: 'p1' }, { id: 'p2' }],
        [{ id: 't1' }]
      );
      state.setProjectSelected('p1', true);
      state.setTeamSelected('t1', false);
      state.setExpansionState({ expandTeamAllocated: true });
      const ids = state.getEffectiveSelectedProjectIds();
      expect(ids).to.deep.equal(['p1']);
    });
  });
});
