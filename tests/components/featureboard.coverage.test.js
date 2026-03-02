import { fixture, html, expect } from '@open-wc/testing';
import '../../www/js/components/FeatureBoard.lit.js';
import { state } from '../../www/js/services/State.js';

describe('FeatureBoard helper coverage', () => {
  beforeEach(async () => { await customElements.whenDefined('feature-board'); });

  it('_sortByRank sorts features by originalRank', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    const feats = [{ originalRank: 2 }, { originalRank: 1 }];
    const res = el._sortByRank(feats.slice());
    expect(res[0].originalRank).to.equal(1);
  });

  it('_sortByDate sorts features by start', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    const a = { start: '2025-01-05' };
    const b = { start: '2025-01-02' };
    const res = el._sortByDate([a, b]);
    expect(res[0].start).to.equal('2025-01-02');
  });

  it('_buildChildrenMap and _orderFeaturesHierarchically produce hierarchical order', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    const epic = { id: 'e1', type: 'epic', originalRank: 1 };
    const child = { id: 'f1', type: 'feature', parentEpic: 'e1', originalRank: 2 };
    const standalone = { id: 'f2', type: 'feature', originalRank: 3 };
    const childrenMap = el._buildChildrenMap([epic, child, standalone]);
    expect(childrenMap.get('e1')).to.exist;
    const ordered = el._orderFeaturesHierarchically([epic, child, standalone], 'rank');
    expect(ordered[0].id).to.equal('e1');
    expect(ordered[1].id).to.equal('f1');
  });

  it('_isUnplanned identifies missing dates', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    expect(el._isUnplanned({})).to.be.true;
    expect(el._isUnplanned({ start: '2025-01-01', end: '2025-01-02' })).to.be.false;
  });

  it('_isHierarchicallyLinkedToSelectedProjectEpics follows parent chain', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    const epic = { id: 'e1', type: 'epic' };
    const child = { id: 'c1', parentEpic: 'e1' };
    const all = [epic, child];
    const selected = new Set(['e1']);
    const res = el._isHierarchicallyLinkedToSelectedProjectEpics(child, all, selected);
    expect(res).to.be.true;
  });

  it('_featurePassesFilters returns true for a basic visible feature', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    // Monkeypatch state services to create a minimal visible environment
    state._projectTeamService.getProjects = () => [{ id: 'p1', selected: true }];
    state._projectTeamService.getTeams = () => [{ id: 't1', selected: true }];
    // Ensure view service flags
    state._viewService.setShowEpics(true);
    state._viewService.setShowFeatures(true);
    state._viewService.setShowUnassignedCards(true);
    state._viewService.setShowUnplannedWork(true);
    state._viewService.setShowOnlyProjectHierarchy(false);
    // State filter service selected states
    state._stateFilterService.setSelectedStates(['New']);

    const feature = { id: 'f1', project: 'p1', type: 'feature', status: 'New', capacity: [{ team: 't1' }] };
    const passes = el._featurePassesFilters(feature, new Map(), [feature]);
    expect(passes).to.be.true;
  });
});
