import { fixture, html, expect } from '@open-wc/testing';
import sinon from 'sinon';
import '../../www/js/components/FeatureBoard.lit.js';

// Ensure `scrollTo` exists on elements in the test environment
if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function () {};
}
describe('FeatureBoard navigation, insertion and viewport behavior', () => {
  beforeEach(async () => {
    await customElements.whenDefined('feature-board');
  });

  it('centers the requested card in the scroll container and highlights it', async () => {
    const wrapper = await fixture(html`
      <div>
        <div id="scroll-container"></div>
        <feature-board></feature-board>
      </div>
    `);
    document.querySelector('timeline-board').appendChild(wrapper);
    const el = wrapper.querySelector('feature-board');
    await el.updateComplete;
    const card = document.createElement('feature-card-lit');
    card.dataset.featureId = 'f1';
    Object.defineProperties(card, {
      offsetLeft: { value: 520 },
      clientWidth: { value: 40 },
      offsetTop: { value: 480 },
      clientHeight: { value: 20 },
    });
    el.shadowRoot.appendChild(card);
    const scrollContainer = wrapper.querySelector('#scroll-container');
    Object.defineProperties(scrollContainer, {
      clientWidth: { value: 300 },
      clientHeight: { value: 400 },
    });
    scrollContainer.scrollTo = sinon.stub();

    el.centerFeatureById('f1');

    expect(scrollContainer.scrollTo.calledOnceWithExactly({
      left: 390, top: 290, behavior: 'smooth',
    })).to.be.true;
    expect(card.classList.contains('search-highlight')).to.be.true;
  });

  it('adds feature titles and supplied nodes as visible board content', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    el.addFeature({ title: 'T1' });
    expect(el.querySelector('[role="listitem"]').textContent).to.equal('T1');
    const div = document.createElement('div');
    div.textContent = 'X';
    el.addFeature(div);
    expect(div.parentElement).to.equal(el);
    expect(el.textContent).to.contain('X');
  });

  it('_computeVisibleRenderItems returns only viewport-intersecting items', async () => {
    const el = await fixture(html`<feature-board></feature-board>`);
    const items = [
      { feature: { id: 'visible-1' }, left: 0, width: 100, top: 0 },
      { feature: { id: 'visible-2' }, left: 120, width: 100, top: 80 },
      { feature: { id: 'hidden-y' }, left: 0, width: 100, top: 2000 },
      { feature: { id: 'hidden-x' }, left: 3000, width: 100, top: 0 },
    ];

    const visible = el._computeVisibleRenderItems(items, {
      left: 0,
      right: 400,
      top: 0,
      bottom: 300,
      overscanX: 0,
      overscanY: 0,
    });

    expect(visible.map((item) => item.feature.id)).to.deep.equal([
      'visible-1',
      'visible-2',
    ]);
  });
});
