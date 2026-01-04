import { expect } from '@esm-bundle/chai';
import { state, PALETTE } from '../../www/js/services/State.js';
import { dataService } from '../../www/js/services/dataService.js';

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
    state._projectTeamService.initFromBaseline([{ id: 'p1' }, { id: 'p2' }], [{ id: 't1' }, { id: 't2' }]);
    state._projectTeamService.setProjectSelected('p1', true);
    state._projectTeamService.setTeamSelected('t2', true);
    const filters = state.captureCurrentFilters();
    expect(filters.projects).to.deep.equal(['p1']);
    expect(filters.teams).to.deep.equal(['t2']);

    state._viewService._capacityViewMode = 'project';
    state._viewService._condensedCards = true;
    state._viewService._featureSortMode = 'date';
    const view = state.captureCurrentView();
    expect(view.capacityViewMode).to.equal('project');
    expect(view.condensedCards).to.equal(true);
    expect(view.featureSortMode).to.equal('date');
  });

  it('setStateFilter, toggleStateSelected, setAllStatesSelected behave', () => {
    state._stateFilterService.setAvailableStates(['Open', 'Done']);
    state._stateFilterService.toggleStateSelected('Open'); // Start with Open selected
    state.setStateFilter(null);
    expect(Array.from(state.selectedFeatureStateFilter)).to.include.members(['Open', 'Done']);
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
    state._projectTeamService.setTeamSelected('t1', true);
    const feature = { capacity: [{ team: 't1', capacity: 50 }, { team: 't2', capacity: 50 }] };
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
    state.setcapacityViewMode('team');
    expect(state.capacityViewMode).to.equal('team');
    state.setFeatureSortMode('rank');
    expect(state.featureSortMode).to.equal('rank');
    // invalid modes should be ignored
    state.setcapacityViewMode('invalid');
    expect(['team','project']).to.include(state.capacityViewMode);
    state.setFeatureSortMode('invalid');
    expect(['date','rank']).to.include(state.featureSortMode);
  });

  it('initColors assigns palette colors when provider returns empty mappings', async () => {
    // Temporarily stub dataService.getColorMappings
    const orig = dataService.getColorMappings;
    dataService.getColorMappings = async () => ({ projectColors: {}, teamColors: {} });
    // seed projects/teams
    state._projectTeamService.initFromBaseline([{ id: 'pp1' }, { id: 'pp2' }], [{ id: 'tt1' }, { id: 'tt2' }, { id: 'tt3' }]);
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
});
