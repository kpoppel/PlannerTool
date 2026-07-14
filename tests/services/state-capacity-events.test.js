import { expect } from '@esm-bundle/chai';

import { bus } from '../../www/js/core/EventBus.js';
import { CapacityEvents } from '../../www/js/core/EventRegistry.js';
import { state } from '../helpers/runtimeState.js';

describe('State capacity event ownership', () => {
  it('publishes one capacity update after a selection causes a calculation', () => {
    state.baselineProjects = [{ id: 'p1', type: 'project' }];
    state.baselineTeams = [{ id: 't1' }];
    state.setBaselineFeatures([
      {
        id: 'f1',
        project: 'p1',
        state: 'Active',
        start: '2025-01-01',
        end: '2025-01-01',
        capacity: [{ team: 't1', capacity: 2 }],
      },
    ]);
    state.initProjectTeamBaseline(state.baselineProjects, state.baselineTeams);
    state.setAvailableFeatureStates(['Active']);
    state.setSelectedStates(['Active']);
    state.setProjectSelected('p1', true);

    const updates = [];
    const unsubscribe = bus.on(CapacityEvents.UPDATED, (payload) => updates.push(payload));
    try {
      state.setTeamSelected('t1', true);
    } finally {
      unsubscribe();
    }

    expect(updates).to.have.lengthOf(1);
    expect(updates[0].dates).to.deep.equal(['2025-01-01']);
    expect(updates[0].teamDailyCapacity).to.deep.equal([[2]]);
  });
});
