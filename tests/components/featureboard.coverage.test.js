import { fixture, html, expect } from '@open-wc/testing';
import '../../www/js/components/FeatureBoard.lit.js';

describe('FeatureBoard helper coverage', () => {
  beforeEach(async () => {
    await customElements.whenDefined('feature-board');
  });

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
    const child = {
      id: 'f1',
      type: 'feature',
      parentId: 'e1',
      originalRank: 2,
    };
    const standalone = { id: 'f2', type: 'feature', originalRank: 3 };
    const childrenMap = el._buildChildrenMap([epic, child, standalone]);
    expect(childrenMap.get('e1')).to.exist;
    const ordered = el._orderFeaturesHierarchically([epic, child, standalone], 'rank');
    expect(ordered[0].id).to.equal('e1');
    expect(ordered[1].id).to.equal('f1');
  });

});
