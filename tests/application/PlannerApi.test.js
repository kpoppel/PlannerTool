import { expect } from '@esm-bundle/chai';

import { createPlannerApi, PLANNER_API_VERSION } from '../../www/js/application/PlannerApi.js';

describe('PlannerApi', () => {
  it('exposes versioned narrow query and command groups', () => {
    const calls = [];
    const state = {
      getEffectiveFeatures: () => [{ id: 'f1' }],
      getEffectiveFeatureById: (id) => ({ id }),
      getFeatureTitleById: (id) => `title:${id}`,
      projects: [{ id: 'p1' }],
      teams: [{ id: 't1' }],
      setProjectSelected: (...args) => calls.push(['project', args]),
      setTeamSelected: (...args) => calls.push(['team', args]),
      setProjectsSelectedBulk: (value) => calls.push(['projects', value]),
      setTeamsSelectedBulk: (value) => calls.push(['teams', value]),
      getExpandedFeatureIds: () => new Set(['f1']),
      scenarios: { list: () => [{ id: 's1' }] },
      getActiveScenario: () => ({ id: 's1' }),
      activateScenario: (id) => calls.push(['activate', id]),
      cloneScenario: (...args) => calls.push(['clone', args]),
      renameScenario: (...args) => calls.push(['rename', args]),
      deleteScenario: (id) => calls.push(['delete', id]),
      saveScenario: (id) => calls.push(['save', id]),
      refreshBaseline: () => calls.push(['refreshBaseline']),
      invalidateAndRefreshBaseline: () => calls.push(['invalidateAndRefreshBaseline']),
      isScenarioUnsaved: (scenario) => scenario.id === 's1',
      groups: {
        create: (...args) => calls.push(['groupCreate', args]),
        update: (...args) => calls.push(['groupUpdate', args]),
        delete: (...args) => calls.push(['groupDelete', args]),
        getPendingChanges: () => [{ id: 'pending' }],
        clearPendingChanges: () => calls.push(['groupClearPending']),
        confirmCreate: (...args) => calls.push(['groupConfirmCreate', args]),
        publishBaseline: (...args) => calls.push(['groupPublishBaseline', args]),
      },
      views: { list: () => [{ id: 'v1' }], getActiveId: () => 'v1', load: (id) => calls.push(['load', id]) },
      capacityDates: ['2025-01-01'],
      teamDailyCapacity: [[1]],
      teamDailyCapacityMap: [{ t1: 1 }],
      projectDailyCapacity: [[1]],
      projectDailyCapacityMap: [{ p1: 1 }],
      totalOrgDailyPerTeamAvg: [1],
    };

    const commands = {
      setProjectSelected: (...args) => calls.push(['project', args]),
      setTeamSelected: (...args) => calls.push(['team', args]),
      setProjectsSelectedBulk: (value) => calls.push(['projects', value]),
      setTeamsSelectedBulk: (value) => calls.push(['teams', value]),
      setExpansionState: (value) => calls.push(['expansion', value]),
      activateScenario: (id) => calls.push(['activate', id]),
      cloneScenario: (...args) => calls.push(['clone', args]),
      renameScenario: (...args) => calls.push(['rename', args]),
      deleteScenario: (id) => calls.push(['delete', id]),
      saveScenario: (id) => calls.push(['save', id]),
      updateFeatureDates: (updates) => calls.push(['dates', updates]),
      updateFeatureField: (...args) => calls.push(['field', args]),
      updateFeatureRelations: (...args) => calls.push(['relations', args]),
      revertFeature: (id) => calls.push(['revert', id]),
      createGroupInScenario: (...args) => calls.push(['createGroupInScenario', args]),
      updateGroupInScenario: (...args) => calls.push(['updateGroupInScenario', args]),
      deleteGroupInScenario: (...args) => calls.push(['deleteGroupInScenario', args]),
      applyGroupMemberDelta: (...args) => calls.push(['applyGroupMemberDelta', args]),
    };
    const selectors = {
      projects: () => state.projects,
      teams: () => state.teams,
      expandedFeatureIds: () => new Set(['f1']),
      view: () => ({
        expansion: {
          parentChild: false,
          relations: false,
          teamAllocated: false,
        },
      }),
    };
    const api = createPlannerApi({ runtime: state, commands, selectors });
    api.features.updateDates([{ id: 'f1' }]);
    api.features.updateRelations('f1', [{ type: 'Related', id: 'f2' }]);
    api.selection.selectProject('p1', true);
    api.scenarios.activate('s1');
    api.scenarios.rename('s1', 'Renamed');
    api.views.load('v1');

    expect(api.version).to.equal(PLANNER_API_VERSION);
    expect(api.features.list()).to.deep.equal([{ id: 'f1' }]);
    expect(api.features.getTitle('f1')).to.equal('title:f1');
    expect(api.selection.getExpandedFeatureIds()).to.deep.equal(new Set(['f1']));
    expect(api.scenarios.hasUnsavedChanges({ id: 's1' })).to.equal(true);
    expect(api.scenarios.getDefaultCloneName(new Date('2026-07-14T00:00:00Z'))).to.equal(
      '07-14 Scenario 1'
    );
    expect(api.groups.getPendingChanges()).to.deep.equal([{ id: 'pending' }]);
    expect(api.capacity.get().dates).to.deep.equal(['2025-01-01']);
    expect(calls).to.deep.equal([
      ['dates', [{ id: 'f1' }]],
      ['relations', ['f1', [{ type: 'Related', id: 'f2' }]]],
      ['project', ['p1', true]],
      ['activate', 's1'],
      ['rename', ['s1', 'Renamed']],
      ['load', 'v1'],
    ]);
    expect(Object.isFrozen(api)).to.equal(true);
    expect(Object.isFrozen(api.features)).to.equal(true);
  });
});
