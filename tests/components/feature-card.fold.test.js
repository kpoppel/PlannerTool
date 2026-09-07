/**
 * Fold affordances on the feature card: the spine chevron (idea 1), the
 * stacked-paper collapsed state (idea 2) and the descendant comb (idea 3).
 */
import { expect, fixture } from '@open-wc/testing';
import sinon from 'sinon';
import '../../www/js/components/FeatureCard.lit.js';

const FEATURE = {
  id: 'epic-1',
  title: 'Epic Alpha',
  start: '2026-01-01',
  end: '2026-01-31',
  capacity: [],
};

async function card(props = {}) {
  const el = await fixture('<feature-card-lit></feature-card-lit>');
  el.feature = { ...FEATURE };
  el.project = { color: '#123456' };
  Object.assign(el, props);
  await el.updateComplete;
  return el;
}

const spine = (el) => el.shadowRoot.querySelector('.fold-spine');
const deck = (el) => el.shadowRoot.querySelector('.deck-edges');
const comb = (el) => el.shadowRoot.querySelector('.comb');
const badge = (el) => el.shadowRoot.querySelector('.fold-badge');

describe('FeatureCard — spine chevron', () => {
  afterEach(() => sinon.restore());

  it('is absent on a leaf task', async () => {
    const el = await card({ foldable: false });
    expect(spine(el)).to.equal(null);
  });

  it('appears on a task that owns visible descendants', async () => {
    const el = await card({ foldable: true });
    expect(spine(el)).to.exist;
  });

  it('reserves gutter space so the card does not reflow on hover', async () => {
    const el = await card({ foldable: true });
    expect(el.shadowRoot.querySelector('.feature-card').classList.contains('foldable')).to
      .be.true;
  });

  it('exposes the expanded state to assistive tech', async () => {
    const el = await card({ foldable: true, collapsed: false });
    expect(spine(el).getAttribute('aria-expanded')).to.equal('true');
    el.collapsed = true;
    await el.updateComplete;
    expect(spine(el).getAttribute('aria-expanded')).to.equal('false');
  });

  it('emits feature-toggle asking to collapse when clicked while expanded', async () => {
    const el = await card({ foldable: true, collapsed: false });
    const events = [];
    el.addEventListener('feature-toggle', (e) => events.push(e.detail));
    spine(el).click();
    expect(events).to.deep.equal([{ featureId: 'epic-1', collapsed: true }]);
  });

  it('emits feature-toggle asking to expand when clicked while collapsed', async () => {
    const el = await card({ foldable: true, collapsed: true });
    const events = [];
    el.addEventListener('feature-toggle', (e) => events.push(e.detail));
    spine(el).click();
    expect(events[0].collapsed).to.equal(false);
  });

  it('does not select the feature when the chevron is clicked', async () => {
    const el = await card({ foldable: true });
    let selected = false;
    el._handleClick = () => {
      selected = true;
    };
    spine(el).click();
    expect(selected).to.equal(false);
  });

  it('crosses the shadow boundary so the board can hear it', async () => {
    const el = await card({ foldable: true });
    let heard = false;
    document.body.addEventListener('feature-toggle', () => {
      heard = true;
    });
    spine(el).click();
    expect(heard).to.equal(true);
  });
});

describe('FeatureCard — collapsed deck', () => {
  it('shows no deck edges while expanded', async () => {
    const el = await card({ foldable: true, collapsed: false });
    expect(deck(el)).to.equal(null);
  });

  it('renders the stacked-paper edges when collapsed', async () => {
    const el = await card({ foldable: true, collapsed: true });
    expect(deck(el)).to.exist;
  });

  it('shows the hidden descendant count when collapsed', async () => {
    const el = await card({ foldable: true, collapsed: true, hiddenCount: 12 });
    expect(badge(el).textContent.trim()).to.equal('12');
  });

  it('hides the count badge while expanded', async () => {
    const el = await card({ foldable: true, collapsed: false, hiddenCount: 12 });
    expect(badge(el)).to.equal(null);
  });

  it('blocks drag and resize while collapsed', async () => {
    const el = await card({ foldable: true, collapsed: true });
    let started = false;
    window.addEventListener('mousemove', () => {
      started = true;
    });
    el._handleMouseDown(
      new MouseEvent('mousedown', { clientX: 10, bubbles: true, composed: true })
    );
    expect(el._boundOnPreMove).to.not.be.a('function');
    expect(started).to.equal(false);
  });

  it('allows drag while expanded', async () => {
    const el = await card({ foldable: true, collapsed: false });
    el._handleMouseDown(
      new MouseEvent('mousedown', { clientX: 10, bubbles: true, composed: true })
    );
    expect(el._boundOnPreMove).to.be.a('function');
  });
});

describe('FeatureCard — descendant comb', () => {
  const extent = { start: '2026-01-01', end: '2026-12-31' };
  const descendants = [
    { id: 'a', start: '2026-01-01', end: '2026-01-31', state: 'Active' },
    { id: 'b', start: '2026-07-01', end: '2026-07-31', state: 'Closed' },
    { id: 'c', start: '2026-12-01', end: '2026-12-31', state: 'Active' },
  ];

  it('is absent while expanded', async () => {
    const el = await card({ foldable: true, collapsed: false, descendants });
    expect(comb(el)).to.equal(null);
  });

  it('draws one tick per dated descendant when collapsed', async () => {
    const el = await card({
      foldable: true,
      collapsed: true,
      descendants,
      subtreeExtent: extent,
    });
    expect(comb(el).querySelectorAll('.comb-tick')).to.have.length(3);
  });

  it('positions ticks by their offset within the rolled-up span', async () => {
    const el = await card({
      foldable: true,
      collapsed: true,
      descendants,
      subtreeExtent: extent,
    });
    const ticks = [...comb(el).querySelectorAll('.comb-tick')];
    const lefts = ticks.map((t) => parseFloat(t.style.left));
    expect(lefts[0]).to.be.closeTo(0, 1);
    expect(lefts[1]).to.be.closeTo(50, 6);
    expect(lefts[2]).to.be.greaterThan(90);
  });

  it('renders nothing when the subtree has no usable span', async () => {
    const el = await card({
      foldable: true,
      collapsed: true,
      descendants,
      subtreeExtent: null,
    });
    expect(comb(el)).to.equal(null);
  });

  it('buckets very large subtrees so the comb stays readable', async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `d${i}`,
      start: '2026-01-01',
      end: '2026-01-31',
      state: 'Active',
    }));
    const el = await card({
      foldable: true,
      collapsed: true,
      descendants: many,
      subtreeExtent: extent,
    });
    expect(comb(el).querySelectorAll('.comb-tick').length).to.be.at.most(
      el.constructor.COMB_MAX_TICKS
    );
  });
});
