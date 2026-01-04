import { expect } from '@open-wc/testing';
import { state } from '../../www/js/services/State.js';

describe('State core behaviors', () => {
  it('computeFeatureOrgLoad respects selected teams', () => {
    // Setup baseline teams and selection
    state.teams = [{ id: 't1', selected: true }, { id: 't2', selected: false }];
    const feature = { capacity: [ { team: 't1', capacity: 3 }, { team: 't2', capacity: 2 } ] };
    const pct = state.computeFeatureOrgLoad(feature);
    expect(pct).to.be.a('string');
    // Only t1 selected => load = 3 / 2 teams = 1.5% -> '1.5%'
    // but compute uses number of teams global (2) so (3/2)=1.5 -> '1.5%'
    expect(pct).to.equal('1.5%');
  });

  it('recomputeCapacityMetrics computes dates and tuples', () => {
    // Minimal baseline data: one team, one project, one feature spanning 3 days
    state.baselineTeams = [{ id: 't1' }];
    state.baselineProjects = [{ id: 'p1' }];
    state.baselineFeatures = [{ id: 'f1', start: '2024-01-01', end: '2024-01-03', project: 'p1', status: 'New', capacity: [{ team: 't1', capacity: 2 }] }];
    // Working copies (no selection filtering)
    state.projects = [{ id: 'p1', selected: true }];
    state.teams = [{ id: 't1', selected: true }];
    // Ensure selectedFeatureStateFilter includes the feature status so it isn't filtered out
    state._stateFilterService.setAvailableStates(['New']);
    state._stateFilterService._selectedStates = new Set(['New']);
    state.scenarios = [{ id: 'baseline', overrides: {}, filters: { projects: [], teams: [] }, view: {} }];
    state.activeScenarioId = 'baseline';
    // Ensure getEffectiveFeatures returns the baseline features for this test
    state.getEffectiveFeatures = () => state.baselineFeatures;
    // Run recompute
    state.recomputeCapacityMetrics();
    expect(state.capacityDates.length).to.equal(3);
    expect(state.teamDailyCapacity.length).to.equal(3);
    expect(state.projectDailyCapacityRaw.length).to.equal(3);
    // Each day team load should be [2]
    expect(state.teamDailyCapacity[0]).to.deep.equal([2]);
    expect(state.projectDailyCapacityRaw[0]).to.deep.equal([2]);
  });

  it('setStateFilter toggles selection and emits updates', async () => {
    state._stateFilterService.setAvailableStates(['New','Done']);
    // Track events
    const events = [];
    const { bus } = await import('../../www/js/core/EventBus.js');
    const { FilterEvents } = await import('../../www/js/core/EventRegistry.js');
    const unsub = bus.on(FilterEvents.CHANGED, (p) => events.push(p));
    
    state.setStateFilter('New');
    expect(events.length).to.be.greaterThan(0);
    
    // Cleanup
    unsub();
  });
});
