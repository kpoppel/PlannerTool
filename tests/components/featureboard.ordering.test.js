import { fixture, html, expect } from '@open-wc/testing';
import '../../www/js/components/FeatureBoard.lit.js';

describe('FeatureBoard behavior', () => {
  beforeEach(async () => {
    await customElements.whenDefined('feature-board');
  });

  it('_branchComparator sorts features by originalRank', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    const feats = [{ id: 'later', originalRank: 2 }, { id: 'earlier', originalRank: 1 }];
    const compareByRank = el._branchComparator('rank', () => ({ children: [] }));
    const res = feats.slice().sort(compareByRank);
    expect(res[0].originalRank).to.equal(1);
  });

  it('_branchComparator sorts features by start', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    const a = { id: 'later', start: '2025-01-05' };
    const b = { id: 'earlier', start: '2025-01-02' };
    const compareByDate = el._branchComparator('date', () => ({ children: [] }));
    const res = [a, b].sort(compareByDate);
    expect(res[0].start).to.equal('2025-01-02');
  });

  it('_buildChildrenMap and _orderFeaturesHierarchically produce hierarchical order', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    const epic = { id: 'e1', type: 'epic', originalRank: 1 };
    const child = {
      id: 'f1',
      type: 'feature',
      parentId: 'e1',
      originalRank: 2,
    };
    const standalone = { id: 'f2', type: 'feature', originalRank: 3 };
    const childrenMap = el._buildChildrenMap([epic, child, standalone]);
    expect(childrenMap.get('e1')).to.exist;
    const compareByRank = el._branchComparator('rank', () => ({ children: [] }));
    const ordered = el._orderFeaturesHierarchically(
      [epic, child, standalone], compareByRank, compareByRank
    );
    expect(ordered[0].id).to.equal('e1');
    expect(ordered[1].id).to.equal('f1');
  });

});
