import { expect } from '@open-wc/testing';
import '../../www/js/components/EmptyBoardModal.lit.js';
import { state } from '../helpers/runtimeState.js';

describe('EmptyBoardModal regression', () => {
  let originalBaselineFeatures;
  let originalGetEffectiveFeatures;
  let originalStateFeatures;
  let originalProjects;
  let originalTeams;
  let originalSelectedStates;
  let originalShowUnplanned;
  let originalShowUnassigned;
  let originalHiddenTypes;

  const restoreTypeVisibility = (hiddenTypes = new Set()) => {
    const knownTypes = new Set([
      'epic',
      'feature',
      'bug',
      ...(Array.isArray(state.availableTaskTypes) ? state.availableTaskTypes : []),
      ...hiddenTypes,
    ]);
    for (const t of knownTypes) {
      state.setTypeVisibility(t, !hiddenTypes.has(t));
    }
  };

  beforeEach(() => {
    originalBaselineFeatures = state.baselineFeatures;
    originalGetEffectiveFeatures = state.getEffectiveFeatures;
    originalStateFeatures = state.features;
    originalProjects = (state.projects || []).map((p) => ({ ...p }));
    originalTeams = (state.teams || []).map((t) => ({ ...t }));
    originalSelectedStates =
      state.selectedFeatureStateFilter instanceof Set ?
        new Set(state.selectedFeatureStateFilter)
      : new Set();
    originalShowUnplanned = state.showUnplannedWork;
    originalShowUnassigned = state.showUnallocatedCards;
    originalHiddenTypes = new Set(state.hiddenTypes || []);
    state.setBaselineFeatures([{ id: 'baseline-1' }]);
  });

  afterEach(() => {
    state.setBaselineFeatures(originalBaselineFeatures);
    state.getEffectiveFeatures = originalGetEffectiveFeatures;
    state.features = originalStateFeatures;
    state.initProjectTeamBaseline(originalProjects, originalTeams);
    state.setSelectedStates(Array.from(originalSelectedStates));
    state.setShowUnplannedWork(originalShowUnplanned);
    state.setShowUnallocatedCards(originalShowUnassigned);
    restoreTypeVisibility(new Set(originalHiddenTypes));
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
    state.initProjectTeamBaseline([{ id: 'p-1' }], [{ id: 't-1' }]);
    state.setProjectSelected('p-1', true);
    state.setTeamSelected('t-1', true);
    state.setSelectedStates(['New']);
    state.setTypeVisibility('feature', true);
    state.setShowUnplannedWork(true);
    state.setShowUnallocatedCards(true);

    const hasVisible = el._hasVisibleFeatures();

    expect(hasVisible).to.equal(true);
  });

  it('explains when selected plans have no associated tasks', () => {
    const el = document.createElement('empty-board-modal');

    state.getEffectiveFeatures = () => [];
    state.setBaselineFeatures([{ id: 'baseline-1', type: 'feature' }]);
    state.initProjectTeamBaseline([{ id: 'p-1' }], []);
    state.setProjectSelected('p-1', true);
    state.setSelectedStates(['New']);
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
    state.setBaselineFeatures([
      { id: 'baseline-1', type: 'feature' },
      { id: 'baseline-2', type: 'epic' },
    ]);
    state.initProjectTeamBaseline([{ id: 'p-1' }], []);
    state.setProjectSelected('p-1', true);
    state.setSelectedStates(['New']);
    restoreTypeVisibility(new Set());

    const reasons = el._computeReasons();

    expect(reasons).to.include('Selected task types have no tasks associated.');
  });
});