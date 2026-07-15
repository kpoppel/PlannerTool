import { expect } from '@esm-bundle/chai';
import '../../www/js/components/FeatureBoard.lit.js';
import * as boardUtils from '../../www/js/components/board-utils.js';
import {
  applicationApi,
  plannerApplication,
} from '../../www/js/application/plannerApplication.js';
import {
  buildFeatureVisibilityContext,
  featurePassesFilters,
} from '../../www/js/services/FeatureVisibilityService.js';
import { state } from '../helpers/runtimeState.js';

describe('feature-board', () => {
  let board;
  beforeEach(() => {
    board = document.createElement('feature-board');
    document.body.appendChild(board);
  });

  afterEach(() => {
    if (board) board.remove();
    // restore state helpers if changed
    if (state.getEffectiveFeatures && state.getEffectiveFeatures.__backup) {
      state.getEffectiveFeatures = state.getEffectiveFeatures.__backup;
    }
  });

  it('renderFeatures computes features from state.getEffectiveFeatures', async () => {
    const feats = [
      {
        id: 'e1',
        type: 'epic',
        start: '2025-01-01',
        end: '2025-02-01',
        project: 'p1',
      },
      {
        id: 'f1',
        type: 'feature',
        start: '2025-01-10',
        end: '2025-01-20',
        project: 'p1',
      },
    ];
    // stub state.getEffectiveFeatures
    state.getEffectiveFeatures = () => feats;
    // ensure projects include p1 selected
    state.initProjectTeamBaseline([{ id: 'p1' }], []);
    state.setProjectSelected('p1', true);
    state.setSelectedStates([]);
    board.renderFeatures();
    // after renderFeatures, board.features should be an array containing items mapped from feats
    expect(board.features).to.be.an('array');
  });

  it('addFeature accepts node and data', () => {
    const node = document.createElement('div');
    node.setAttribute('data-feature-id', 'x');
    board.addFeature(node);
    // adding node shouldn't throw and features array remains present
    expect(Array.isArray(board.features) || board.features === undefined).to.be.true;
  });

  it('renderFeatures shows team-allocated expansion results with no selected plans', async () => {
    const runtime = plannerApplication.services.runtime;
    const store = plannerApplication.store;
    const originalGetEffectiveFeatures = runtime.getEffectiveFeatures.bind(runtime);
    const originalComputePosition = boardUtils.computePosition;

    const features = [
      {
        id: 'e1',
        type: 'epic',
        start: '2025-01-01',
        end: '2025-02-01',
        project: 'p2',
        state: 'New',
        capacity: [],
      },
      {
        id: 'f1',
        type: 'feature',
        start: '2025-01-10',
        end: '2025-01-20',
        project: 'p2',
        state: 'New',
        parentId: 'e1',
        capacity: [{ team: 't1', capacity: 1 }],
      },
    ];

    runtime.getEffectiveFeatures = () => features;
    Object.defineProperty(boardUtils, 'computePosition', {
      configurable: true,
      writable: true,
      value: () => ({ left: 100, width: 80 }),
    });

    store.update('test.featureBoardTeamExpansion', (draft) => {
      draft.baseline.projects = [
        { id: 'p1', name: 'Plan A', color: '#aa0000' },
        { id: 'p2', name: 'Plan B', color: '#00aa00' },
      ];
      draft.baseline.teams = [{ id: 't1', name: 'Team One', color: '#111111' }];
      draft.baseline.features = features;
      draft.selection.projectIds = [];
      draft.selection.teamIds = ['t1'];
      draft.view.expansion.parentChild = false;
      draft.view.expansion.relations = false;
      draft.view.expansion.teamAllocated = true;
    });
    state.setShowOnlyProjectHierarchy(false);
    state.setShowUnplannedWork(true);
    state.setShowUnallocatedCards(true);
    state.setTypeVisibility('epic', true, true);
    state.setTypeVisibility('feature', true, true);
    state.setSelectedStates(['New']);

    try {
      expect(store.getState().selection.teamIds).to.deep.equal(['t1']);
      expect(store.getState().view.expansion.teamAllocated).to.equal(true);
      expect(Array.from(plannerApplication.selectors.expandedFeatureIds())).to.deep.equal(['f1']);

      const visibilityContext = buildFeatureVisibilityContext({
        state: applicationApi,
        allFeatures: features,
        childrenMap: board._buildChildrenMap(features),
      });
      expect(visibilityContext.hasExpansion).to.equal(true);
      expect(Array.from(visibilityContext.expandedIds || [])).to.deep.equal(['f1']);
      expect(featurePassesFilters(features[1], visibilityContext)).to.equal(true);

      await board.renderFeatures();
      expect(board.features.map((item) => item.feature?.id)).to.deep.equal(['f1']);
      expect(board._swimlanes.map((lane) => lane.id)).to.deep.equal(['t1']);
    } finally {
      runtime.getEffectiveFeatures = originalGetEffectiveFeatures;
      Object.defineProperty(boardUtils, 'computePosition', {
        configurable: true,
        writable: true,
        value: originalComputePosition,
      });
    }
  });
});
