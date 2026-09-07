/**
 * Board-level behaviour of parent/child folding: when hierarchy ordering turns
 * on, what a collapsed parent hides, and how the fold state is driven.
 */
import { expect } from '@open-wc/testing';
import sinon from 'sinon';
import { initTimeline, _resetTimelineState } from '../../www/js/components/Timeline.lit.js';
import '../../www/js/components/FeatureBoard.lit.js';
import { sel } from '../../www/js/application/imports.js';

describe('FeatureBoard — hierarchy folding', () => {
  let board;
  let displayMode;
  let effectiveFeatures;
  let projects;
  let expansion;

  const feature = (id, parentId, rank) => ({
    id,
    parentId,
    title: `Task ${id}`,
    type: 'feature',
    start: '2025-01-01',
    end: '2025-03-31',
    project: 'p1',
    state: 'Active',
    capacity: [],
    originalRank: rank,
  });

  /**
   * epic
   *  ├── featA
   *  │    └── story
   *  └── featB
   */
  const tree = () => [
    feature('epic', null, 1),
    feature('featA', 'epic', 2),
    feature('story', 'featA', 3),
    feature('featB', 'epic', 4),
  ];

  const renderedIds = () =>
    board.features.filter((i) => !i.isGroup).map((i) => i.feature.id);

  const rowFor = (id) =>
    board.features.find((i) => !i.isGroup && i.feature.id === id);

  beforeEach(async () => {
    _resetTimelineState();
    const timelineEl = document.createElement('timeline-lit');
    document.body.appendChild(timelineEl);
    await initTimeline();

    await customElements.whenDefined('feature-board');
    board = document.createElement('feature-board');
    document.body.appendChild(board);

    displayMode = 'normal';
    effectiveFeatures = tree();
    projects = [{ id: 'p1', name: 'Plan A', color: '#aa0000', selected: true }];
    expansion = {
      expandParentChild: false,
      expandRelations: false,
      expandTeamAllocated: false,
    };

    sinon.stub(sel.feature, 'getEffectiveFeatures').callsFake(() => effectiveFeatures);
    sinon.stub(sel.selection, 'getProjects').callsFake(() => projects);
    sinon.stub(sel.selection, 'getTeams').returns([]);
    sinon.stub(sel.selection, 'getSelectedProjectIds').callsFake(() =>
      projects.filter((p) => p.selected).map((p) => p.id)
    );
    sinon.stub(sel.selection, 'getSelectedTeamIds').returns([]);
    sinon.stub(sel.view, 'getPackedMode').callsFake(() => displayMode === 'packed');
    sinon.stub(sel.view, 'getCondensedCards').callsFake(() => displayMode !== 'normal');
    sinon.stub(sel.view, 'getFeatureSortMode').returns('rank');
    sinon.stub(sel.view, 'getExpansionState').callsFake(() => expansion);
    sinon.stub(sel.view, 'getExpandedFeatureIds').callsFake(
      () => new Set(effectiveFeatures.map((f) => String(f.id)))
    );
    sinon.stub(sel.view, 'getShowOnlyProjectHierarchy').returns(false);
    sinon.stub(sel.view, 'getShowUnplannedWork').returns(true);
    sinon.stub(sel.view, 'getShowUnassignedCards').returns(true);
    sinon.stub(sel.view, 'isTypeVisible').returns(true);
    sinon.stub(sel.filter, 'getSelectedFeatureStateSet').returns(new Set(['Active']));
    sinon.stub(sel.filter, 'featurePassesFilters').returns(true);
    sinon.stub(sel.group, 'getEffectiveGroups').returns([]);
  });

  afterEach(() => {
    board.remove();
    sinon.restore();
  });

  describe('when hierarchy ordering is active', () => {
    it('is active for a single selected plan', async () => {
      await board.renderFeatures();
      expect(board.isHierarchyFoldActive()).to.equal(true);
    });

    it('is active when parent/child expansion is on across several plans', async () => {
      projects = [
        { id: 'p1', name: 'Plan A', color: '#a00', selected: true },
        { id: 'p2', name: 'Plan B', color: '#0a0', selected: true },
      ];
      expansion = { ...expansion, expandParentChild: true };
      await board.renderFeatures();
      expect(board.isHierarchyFoldActive()).to.equal(true);
    });

    it('is inactive for several plans without parent/child expansion', async () => {
      projects = [
        { id: 'p1', name: 'Plan A', color: '#a00', selected: true },
        { id: 'p2', name: 'Plan B', color: '#0a0', selected: true },
      ];
      await board.renderFeatures();
      expect(board.isHierarchyFoldActive()).to.equal(false);
    });

    it('is inactive in packed mode', async () => {
      displayMode = 'packed';
      await board.renderFeatures();
      expect(board.isHierarchyFoldActive()).to.equal(false);
    });

    it('orders descendants directly beneath their parent', async () => {
      await board.renderFeatures();
      expect(renderedIds()).to.deep.equal(['epic', 'featA', 'story', 'featB']);
    });
  });

  describe('collapsing', () => {
    it('hides the whole subtree of a collapsed task', async () => {
      await board.renderFeatures();
      await board.setFeatureCollapsed('featA', true);
      expect(renderedIds()).to.deep.equal(['epic', 'featA', 'featB']);
    });

    it('hides nested descendants when the root is collapsed', async () => {
      await board.renderFeatures();
      await board.setFeatureCollapsed('epic', true);
      expect(renderedIds()).to.deep.equal(['epic']);
    });

    it('restores the subtree when expanded again', async () => {
      await board.renderFeatures();
      await board.setFeatureCollapsed('epic', true);
      await board.setFeatureCollapsed('epic', false);
      expect(renderedIds()).to.deep.equal(['epic', 'featA', 'story', 'featB']);
    });

    it('marks the collapsed row and reports what it hides', async () => {
      await board.renderFeatures();
      await board.setFeatureCollapsed('epic', true);
      const row = rowFor('epic');
      expect(row.collapsed).to.equal(true);
      expect(row.hiddenCount).to.equal(3);
    });

    it('responds to a feature-toggle event from a card', async () => {
      await board.renderFeatures();
      board.dispatchEvent(
        new CustomEvent('feature-toggle', {
          detail: { featureId: 'featA', collapsed: true },
          bubbles: true,
          composed: true,
        })
      );
      await board.updateComplete;
      expect(renderedIds()).to.not.include('story');
    });
  });

  describe('depth stepper', () => {
    it('reports the deepest level in the dataset', async () => {
      await board.renderFeatures();
      expect(board.getHierarchyMaxDepth()).to.equal(2);
    });

    it('collapsing to one level leaves only root rows', async () => {
      await board.renderFeatures();
      await board.collapseToDepth(1);
      expect(renderedIds()).to.deep.equal(['epic']);
    });

    it('collapsing to two levels leaves roots and their children', async () => {
      await board.renderFeatures();
      await board.collapseToDepth(2);
      expect(renderedIds()).to.deep.equal(['epic', 'featA', 'featB']);
    });

    it('collapsing to the full depth shows everything', async () => {
      await board.renderFeatures();
      await board.collapseToDepth(1);
      await board.collapseToDepth(3);
      expect(renderedIds()).to.deep.equal(['epic', 'featA', 'story', 'featB']);
    });
  });

  describe('reported fold depth', () => {
    const lastDepth = async () => {
      const { bus } = await import('../../www/js/core/EventBus.js');
      const { BoardEvents } = await import('../../www/js/core/EventRegistry.js');
      let seen;
      const handler = (p) => {
        seen = p;
      };
      bus.on(BoardEvents.HIERARCHY_CHANGED, handler);
      await board.renderFeatures();
      bus.off(BoardEvents.HIERARCHY_CHANGED, handler);
      return seen;
    };

    it('reports the fully-expanded depth when nothing is folded', async () => {
      const payload = await lastDepth();
      expect(payload.depth).to.equal(3);
    });

    it('reports the level chosen through the stepper', async () => {
      await board.renderFeatures();
      await board.collapseToDepth(2);
      expect((await lastDepth()).depth).to.equal(2);
    });

    it('reports no fixed level once a single card is folded by hand', async () => {
      await board.renderFeatures();
      await board.setFeatureCollapsed('featA', true);
      expect((await lastDepth()).depth).to.equal(null);
    });

    it('returns to the fully-expanded depth when the hand fold is undone', async () => {
      await board.renderFeatures();
      await board.setFeatureCollapsed('featA', true);
      await board.setFeatureCollapsed('featA', false);
      expect((await lastDepth()).depth).to.equal(3);
    });
  });

  describe('swimlane mode', () => {
    // Parent/child expansion is what puts the board into swimlanes, and it is
    // also the main way users reach folding — so the swimlane layout path must
    // carry the fold metadata just like the group band path does.
    beforeEach(() => {
      projects = [
        { id: 'p1', name: 'Plan A', color: '#a00', selected: true },
        { id: 'p2', name: 'Plan B', color: '#0a0', selected: true },
      ];
      expansion = { ...expansion, expandParentChild: true };
    });

    it('marks foldable rows inside swimlanes', async () => {
      await board.renderFeatures();
      const epic = rowFor('epic');
      expect(epic.foldable).to.equal(true);
      expect(epic.hiddenCount).to.equal(3);
    });

    it('stamps the nesting depth inside swimlanes', async () => {
      await board.renderFeatures();
      expect(rowFor('story').hierarchyDepth).to.equal(2);
    });

    it('orders descendants beneath their parent inside swimlanes', async () => {
      await board.renderFeatures();
      expect(renderedIds()).to.deep.equal(['epic', 'featA', 'story', 'featB']);
    });

    it('folds a subtree away inside swimlanes', async () => {
      await board.renderFeatures();
      await board.setFeatureCollapsed('featA', true);
      expect(renderedIds()).to.deep.equal(['epic', 'featA', 'featB']);
    });
  });

  describe('packed mode', () => {
    it('does not mark any row foldable', async () => {
      displayMode = 'packed';
      await board.renderFeatures();
      expect(board.features.some((i) => i.foldable)).to.equal(false);
    });
  });
});
