import { expect } from '@open-wc/testing';
import '../../www/js/components/EmptyBoardModal.lit.js';
import { state } from '../../www/js/services/State.js';

describe('EmptyBoardModal regression', () => {
  let originalBaselineFeatures;
  let originalGetEffectiveFeatures;
  let originalStateFeatures;
  let originalGetProjects;
  let originalGetTeams;
  let originalSelectedStates;
  let originalShowUnplanned;
  let originalShowUnassigned;
  let originalHiddenTypes;
  let originalAvailableTaskTypesCache;

  const restoreTypeVisibility = (hiddenTypes = new Set()) => {
    const knownTypes = new Set([
      'epic',
      'feature',
      'bug',
      ...(Array.isArray(state._availableTaskTypesCache) ? state._availableTaskTypesCache : []),
      ...hiddenTypes,
    ]);
    for (const t of knownTypes) {
      state._viewService.setTypeVisibility(t, !hiddenTypes.has(t));
    }
  };

  beforeEach(() => {
    originalBaselineFeatures = state.baselineFeatures;
    originalGetEffectiveFeatures = state.getEffectiveFeatures;
    originalStateFeatures = state.features;
    originalGetProjects = state._projectTeamService.getProjects;
    originalGetTeams = state._projectTeamService.getTeams;
    originalSelectedStates =
      state._stateFilterService?.selectedFeatureStateFilter instanceof Set ?
        new Set(state._stateFilterService.selectedFeatureStateFilter)
      : new Set();
    originalShowUnplanned = state._viewService.showUnplannedWork;
    originalShowUnassigned = state._viewService.showUnassignedCards;
    originalHiddenTypes = new Set(state._viewService.hiddenTypes || []);
    originalAvailableTaskTypesCache =
      Array.isArray(state._availableTaskTypesCache) ?
        [...state._availableTaskTypesCache]
      : state._availableTaskTypesCache;
    state.baselineFeatures = [{ id: 'baseline-1' }];
  });

  afterEach(() => {
    state.baselineFeatures = originalBaselineFeatures;
    state.getEffectiveFeatures = originalGetEffectiveFeatures;
    state.features = originalStateFeatures;
    state._projectTeamService.getProjects = originalGetProjects;
    state._projectTeamService.getTeams = originalGetTeams;
    state._stateFilterService.setSelectedStates(Array.from(originalSelectedStates));
    state._viewService.setShowUnplannedWork(originalShowUnplanned);
    state._viewService.setShowUnallocatedCards(originalShowUnassigned);
    restoreTypeVisibility(new Set(originalHiddenTypes));
    state._availableTaskTypesCache = originalAvailableTaskTypesCache;
  });

  it('closes itself when tasks become visible after being open', () => {
    const el = document.createElement('empty-board-modal');
    el.open = true;

    let closeEventCount = 0;
    el.addEventListener('modal-close', () => {
      closeEventCount += 1;
    });

    el._hasVisibleFeatures = () => true;

    el._recomputeAndMaybeClose();

    expect(el.open).to.equal(false);
    expect(closeEventCount).to.equal(1);
  });

  it('uses effective features as source for visibility checks', () => {
    const el = document.createElement('empty-board-modal');
    const feature = {
      id: 'f-1',
      project: 'p-1',
      type: 'feature',
      state: 'New',
      start: '2026-01-01',
      end: '2026-01-05',
      capacity: [{ team: 't-1', capacity: 1 }],
    };

    state.features = [];
    state.getEffectiveFeatures = () => [feature];
    state._projectTeamService.getProjects = () => [{ id: 'p-1', selected: true }];
    state._projectTeamService.getTeams = () => [{ id: 't-1', selected: true }];
    state._stateFilterService.setSelectedStates(['New']);
    state._viewService.setTypeVisibility('feature', true);
    state._viewService.setShowUnplannedWork(true);
    state._viewService.setShowUnallocatedCards(true);

    const hasVisible = el._hasVisibleFeatures();

    expect(hasVisible).to.equal(true);
  });

  it('explains when selected plans have no associated tasks', () => {
    const el = document.createElement('empty-board-modal');

    state.getEffectiveFeatures = () => [];
    state._projectTeamService.getProjects = () => [{ id: 'p-1', selected: true }];
    state._projectTeamService.getTeams = () => [];
    state._stateFilterService.setSelectedStates(['New']);
    state._availableTaskTypesCache = ['feature'];
    restoreTypeVisibility(new Set());

    const reasons = el._computeReasons();

    expect(reasons).to.include('Selected projects/plans have no tasks associated.');
  });

  it('explains when selected task types have no associated tasks', () => {
    const el = document.createElement('empty-board-modal');

    state.getEffectiveFeatures = () => [
      {
        id: 'f-2',
        project: 'p-1',
        type: 'bug',
        state: 'New',
      },
    ];
    state._projectTeamService.getProjects = () => [{ id: 'p-1', selected: true }];
    state._projectTeamService.getTeams = () => [];
    state._stateFilterService.setSelectedStates(['New']);
    state._availableTaskTypesCache = ['feature', 'epic'];
    restoreTypeVisibility(new Set());

    const reasons = el._computeReasons();

    expect(reasons).to.include('Selected task types have no tasks associated.');
  });
});