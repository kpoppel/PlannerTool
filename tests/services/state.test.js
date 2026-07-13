import { expect } from '@open-wc/testing';
import { state } from '../../www/js/services/State.js';

describe('State core behaviors', () => {
  it('computeFeatureOrgLoad respects selected teams', () => {
    // Setup baseline teams and selection using ProjectTeamService
    const teams = [{ id: 't1' }, { id: 't2' }];
    state.initProjectTeamBaseline([], teams);
    state.setTeamSelected('t1', true);
    state.setTeamSelected('t2', false);

    const feature = {
      capacity: [
        { team: 't1', capacity: 3 },
        { team: 't2', capacity: 2 },
      ],
    };
    const pct = state.computeFeatureOrgLoad(feature);
    expect(pct).to.be.a('string');
    // Only t1 selected => denominator counts only selected teams (1), not
    // the total team count (2): load = 3 / 1 = 3.0%
    expect(pct).to.equal('3.0%');
  });

  it('recomputeCapacityMetrics computes dates and tuples', () => {
    // Minimal baseline data: one team, one project, one feature spanning 3 days
    state.baselineTeams = [{ id: 't1' }];
    state.baselineProjects = [{ id: 'p1' }];
    state.setBaselineFeatures([
      {
        id: 'f1',
        start: '2024-01-01',
        end: '2024-01-03',
        project: 'p1',
        state: 'New',
        capacity: [{ team: 't1', capacity: 2 }],
      },
    ]);
    // Working copies (no selection filtering) - use ProjectTeamService
    state.initProjectTeamBaseline([{ id: 'p1' }], [{ id: 't1' }]);
    state.setProjectSelected('p1', true);
    state.setTeamSelected('t1', true);
    // Ensure selectedFeatureStateFilter includes the feature status so it isn't filtered out
    state.setAvailableFeatureStates(['New']);
    state.setSelectedStates(['New']);
    // Ensure baseline scenario exists and is active
    state.initDefaultScenario();
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
    // Project capacity includes the original project plus unfunded (which should be 0 for properly linked features)
    expect(state.projectDailyCapacityRaw[0]).to.deep.equal([2, 0]);
  });

  it('setStateFilter toggles selection and emits updates', async () => {
    state.setAvailableFeatureStates(['New', 'Done']);
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
