import { expect } from '@open-wc/testing';

import { state as S } from '../../www/js/services/State.js';

// Use exported singleton `state` but snapshot/restore properties we mutate
describe('State (unit)', () => {
  let backup = {};
  beforeEach(() => {
    backup = {
      teams: JSON.parse(JSON.stringify(S.teams || [])),
      projects: JSON.parse(JSON.stringify(S.projects || [])),
      availableFeatureStates: JSON.parse(JSON.stringify(S.availableFeatureStates || [])),
      selectedFeatureStateFilter: new Set(Array.from(S.selectedFeatureStateFilter || [])),
      timelineScale: S.timelineScale,
      showEpics: S.showEpics,
      showFeatures: S.showFeatures,
      condensedCards: S.condensedCards,
      capacityViewMode: S.capacityViewMode,
      featureSortMode: S.featureSortMode,
      showDependencies: S.showDependencies
    };
  });
  afterEach(() => {
    S.teams = JSON.parse(JSON.stringify(backup.teams));
    S.projects = JSON.parse(JSON.stringify(backup.projects));
    S._stateFilterService.setAvailableStates(JSON.parse(JSON.stringify(backup.availableFeatureStates)));
    // Restore selected states
    S._stateFilterService._selectedStates = new Set(Array.from(backup.selectedFeatureStateFilter || []));
    S._viewService._timelineScale = backup.timelineScale;
    S._viewService._showEpics = backup.showEpics;
    S._viewService._showFeatures = backup.showFeatures;
    S._viewService._condensedCards = backup.condensedCards;
    S._viewService._capacityViewMode = backup.capacityViewMode;
    S._viewService._featureSortMode = backup.featureSortMode;
    S._viewService._showDependencies = backup.showDependencies;
  });

  it('computeFeatureOrgLoad calculates percent correctly', () => {
    S.teams = [ { id:'t1', selected:true }, { id:'t2', selected:false } ];
    const f = { capacity: [ { team:'t1', capacity: 50 }, { team:'t2', capacity: 20 } ] };
    const load = S.computeFeatureOrgLoad(f);
    // Only t1 selected -> sum=50, numTeams=2 -> 25.0%
    expect(load).to.equal('25.0%');
  });

  it('recomputeDerived detects changed fields', () => {
    const base = { start: '2025-01-01', end: '2025-02-01' };
    const o = { start: '2025-01-02' };
    const r = S.recomputeDerived(base, o);
    expect(r.dirty).to.equal(true);
    expect(r.changedFields).to.include('start');
  });

  it('captureCurrentFilters and captureCurrentView return expected shapes', () => {
    S.projects = [ { id:'p1', selected:true }, { id:'p2', selected:false } ];
    S.teams = [ { id:'t1', selected:true } ];
    const filters = S.captureCurrentFilters();
    expect(filters.projects).to.include('p1');
    const view = S.captureCurrentView();
    expect(view).to.have.property('capacityViewMode');
  });

  it('setStateFilter toggles selection and emits events (no throw)', () => {
    // Ensure available states present
    S._stateFilterService.setAvailableStates(['A','B']);
    S.setStateFilter(null);
    expect(S.selectedFeatureStateFilter.size).to.be.greaterThan(0);
    S.setStateFilter('A');
    expect(S.selectedFeatureStateFilter.has('A')).to.equal(true);
  });

  it('toggleStateSelected handles add/remove safely', () => {
    S._stateFilterService.setAvailableStates(['A','B']); S._stateFilterService._selectedStates = ['A'];
    S.toggleStateSelected('A'); expect(S.selectedFeatureStateFilter.has('A')).to.equal(false);
    S.toggleStateSelected('B'); expect(S.selectedFeatureStateFilter.has('B')).to.equal(true);
  });

  it('setAllStatesSelected sets/clears all', () => {
    S._stateFilterService.setAvailableStates(['A','B']);
    S.setAllStatesSelected(true); expect(S.selectedFeatureStateFilter.size).to.equal(2);
    S.setAllStatesSelected(false); expect(S.selectedFeatureStateFilter.size).to.equal(0);
  });

  it('view toggles set values and do not throw', () => {
    S.setTimelineScale('days'); expect(S.timelineScale).to.equal('days');
    S.setShowEpics(false); expect(S.showEpics).to.equal(false);
    S.setShowFeatures(false); expect(S.showFeatures).to.equal(false);
    S.setCondensedCards(true); expect(S.condensedCards).to.equal(true);
    S.setShowDependencies(true); expect(S.showDependencies).to.equal(true);
    S.setcapacityViewMode('project'); expect(S.capacityViewMode).to.equal('project');
    S.setFeatureSortMode('date'); expect(S.featureSortMode).to.equal('date');
  });
});
