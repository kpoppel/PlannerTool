import { expect } from '@esm-bundle/chai';

import { selectActiveScenario, selectActiveWritableScenario } from '../../www/js/application/selectors/scenarioSelectors.js';
import {
  selectIterationResolutionForProject,
  selectIterationsForProject,
} from '../../www/js/application/selectors/iterationSelectors.js';
import {
  selectCapacityEventPayload,
  selectCapacitySnapshot,
} from '../../www/js/application/selectors/capacitySelectors.js';
import {
  selectChangedFeatureFields,
  selectFeatureDirtyMetadata,
  selectFeatureIdsFromUpdates,
} from '../../www/js/application/selectors/featureSelectors.js';
import {
  selectScenarioSavePayload,
  selectUnsavedWritableScenarios,
} from '../../www/js/application/selectors/scenarioSelectors.js';
import {
  selectAllIds,
  selectSelectedIds,
  selectSelectedStateNames,
} from '../../www/js/application/selectors/selectionSelectors.js';
import { selectTeamAllocationExpansionFeatures } from '../../www/js/application/selectors/expansionSelectors.js';

describe('runtime selectors', () => {
  it('selects active and active writable scenarios', () => {
    const scenarios = [
      { id: 'baseline', readonly: true },
      { id: 'scenario-a', readonly: false },
    ];

    expect(selectActiveScenario(scenarios, 'scenario-a')?.id).to.equal('scenario-a');
    expect(selectActiveScenario(scenarios, null)).to.equal(null);

    expect(selectActiveWritableScenario(scenarios, 'baseline')).to.equal(null);
    expect(selectActiveWritableScenario(scenarios, 'scenario-a')?.id).to.equal('scenario-a');

    expect(
      selectUnsavedWritableScenarios(scenarios, (scenario) => scenario.id === 'scenario-a').map(
        (scenario) => scenario.id
      )
    ).to.deep.equal(['scenario-a']);
  });

  it('returns project iterations by project id', () => {
    const iterationsByProject = {
      projectA: {
        iterations: [{ id: 'it-1' }],
        matchedRuleId: 'rule-a',
        fallbackUsed: false,
        resolutionWarnings: [],
        sourceProject: 'ADO',
        roots: ['Root'],
      },
    };

    expect(selectIterationsForProject(iterationsByProject, 'projectA')).to.deep.equal([
      { id: 'it-1' },
    ]);
    expect(selectIterationsForProject(iterationsByProject, 'projectB')).to.deep.equal([]);
    expect(selectIterationsForProject(iterationsByProject, null)).to.deep.equal([]);

    expect(selectIterationResolutionForProject(iterationsByProject, 'projectA')).to.deep.equal({
      matchedRuleId: 'rule-a',
      fallbackUsed: false,
      resolutionWarnings: [],
      sourceProject: 'ADO',
      roots: ['Root'],
    });
    expect(selectIterationResolutionForProject(iterationsByProject, 'projectB')).to.equal(null);
  });

  it('normalizes canonical capacity snapshots and maps to legacy event payload', () => {
    const snapshot = selectCapacitySnapshot({
      dates: ['2026-01-01'],
      teamDaily: [{ team: 't1', value: 8 }],
      organizationDailyPerTeamAverage: [8],
    });

    expect(snapshot).to.deep.equal({
      dates: ['2026-01-01'],
      teamDaily: [{ team: 't1', value: 8 }],
      teamDailyMap: [],
      projectDailyRaw: [],
      projectDaily: [],
      projectDailyMap: [],
      organizationDaily: [],
      organizationDailyPerTeamAverage: [8],
    });

    expect(
      selectCapacityEventPayload({
        dates: snapshot.dates,
        teamDaily: snapshot.teamDaily,
        teamDailyMap: snapshot.teamDailyMap,
        projectDailyRaw: snapshot.projectDailyRaw,
        projectDaily: snapshot.projectDaily,
        projectDailyMap: snapshot.projectDailyMap,
        organizationDaily: [10],
        organizationDailyPerTeamAverage: [5],
      })
    ).to.deep.equal({
      dates: ['2026-01-01'],
      teamDailyCapacity: [{ team: 't1', value: 8 }],
      teamDailyCapacityMap: [],
      projectDailyCapacityRaw: [],
      projectDailyCapacity: [],
      projectDailyCapacityMap: [],
      totalOrgDailyCapacity: [10],
      totalOrgDailyPerTeamAvg: [5],
    });
  });

  it('derives feature dirty metadata from baseline and override snapshots', () => {
    const featureBase = {
      start: '2026-01-01',
      end: '2026-01-05',
      capacity: [{ team: 't1', capacity: 2 }],
    };

    expect(selectChangedFeatureFields(featureBase, null)).to.deep.equal([]);
    expect(
      selectChangedFeatureFields(featureBase, {
        start: '2026-01-02',
        end: '2026-01-05',
      })
    ).to.deep.equal(['start']);

    expect(
      selectFeatureDirtyMetadata(featureBase, {
        start: '2026-01-02',
        end: '2026-01-06',
        capacity: [{ team: 't1', capacity: 3 }],
      })
    ).to.deep.equal({
      changedFields: ['start', 'end', 'capacity'],
      dirty: true,
    });

    expect(selectFeatureIdsFromUpdates([{ id: 'a' }, { id: '' }, {}, { id: 'b' }])).to.deep.equal([
      'a',
      'b',
    ]);
    expect(selectFeatureIdsFromUpdates(null)).to.deep.equal([]);
  });

  it('builds normalized scenario save payloads', () => {
    expect(selectScenarioSavePayload(null)).to.equal(null);

    expect(
      selectScenarioSavePayload({
        id: 'scenario-a',
        name: 'Scenario A',
        overrides: { feature1: { start: '2026-01-01' } },
        filters: { projects: ['p1'] },
        view: { displayMode: 'normal' },
        scenarioGroups: [{ id: 'temp-1', name: 'Team A' }],
        groupOverrides: { baselineGroup1: { name: 'Renamed' } },
      })
    ).to.deep.equal({
      id: 'scenario-a',
      name: 'Scenario A',
      overrides: { feature1: { start: '2026-01-01' } },
      filters: { projects: ['p1'] },
      view: { displayMode: 'normal' },
      scenarioGroups: [{ id: 'temp-1', name: 'Team A' }],
      groupOverrides: { baselineGroup1: { name: 'Renamed' } },
    });

    expect(
      selectScenarioSavePayload({
        id: 'scenario-b',
        name: 'Scenario B',
        overrides: {},
        filters: {},
        view: {},
        scenarioGroups: [],
        groupOverrides: {},
      })
    ).to.deep.equal({
      id: 'scenario-b',
      name: 'Scenario B',
      overrides: {},
      filters: {},
      view: {},
    });
  });

  it('derives selected ids and state names for capacity and expansion inputs', () => {
    expect(
      selectSelectedIds([
        { id: 't1', selected: true },
        { id: 't2', selected: false },
        { id: 't3', selected: true },
      ])
    ).to.deep.equal(['t1', 't3']);
    expect(selectAllIds([{ id: 'p1' }, { id: 'p2' }, {}])).to.deep.equal(['p1', 'p2']);
    expect(selectSelectedStateNames(new Set(['In Progress', 'Committed']))).to.deep.equal([
      'In Progress',
      'Committed',
    ]);
    expect(selectSelectedStateNames(['Done'])).to.deep.equal(['Done']);
  });

  it('gates team-allocation expansion features by mode and team selection', () => {
    const features = [{ id: 'f1' }];

    expect(
      selectTeamAllocationExpansionFeatures({
        features,
        selectedTeamIds: ['t1'],
        expandTeamAllocated: true,
      })
    ).to.deep.equal(features);

    expect(
      selectTeamAllocationExpansionFeatures({
        features,
        selectedTeamIds: [],
        expandTeamAllocated: true,
      })
    ).to.deep.equal([]);

    expect(
      selectTeamAllocationExpansionFeatures({
        features,
        selectedTeamIds: ['t1'],
        expandTeamAllocated: false,
      })
    ).to.deep.equal([]);
  });
});
