import { expect, fixture, html } from '@open-wc/testing';
import { featureFlags } from '../../www/js/config.js';
import { state } from '../../www/js/services/State.js';

// Define a lightweight mock for feature-card-lit so tests don't require Lit runtime.
if(!customElements.get('feature-card-lit')){
  class MockFeatureCard extends HTMLElement{
    constructor(){ super(); this.feature = {}; this.selected = false; }
    applyVisuals({ left, width, selected, dirty, project } = {}){
      if(left !== undefined) this.style.left = left;
      if(width !== undefined) this.style.width = width;
      if(selected !== undefined) this.selected = !!selected;
      if(dirty !== undefined) this.feature = Object.assign({}, this.feature, { dirty });
      if(project !== undefined) this.project = project;
    }
  }
  customElements.define('feature-card-lit', MockFeatureCard);
}

describe('FeatureBoard incremental updates', () => {
  before(() => {
    // Ensure lit path is enabled for these tests
    featureFlags.USE_LIT_COMPONENTS = true;
  });

  it('updateCardsById patches existing lit cards', async () => {
    // Stub ResizeObserver to avoid loop errors in headless test runs
    if(!window.__origResizeObserver){ window.__origResizeObserver = window.ResizeObserver; }
    window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };

    // Ensure the feature-board component is registered
    await import('../../www/js/components/FeatureBoard.lit.js');
    const board = await fixture(html`<feature-board id="featureBoard"></feature-board>`);
    // Ensure timeline DOM exists and months cache is initialized for computePosition
    const header = document.createElement('div'); header.id = 'timelineHeader'; document.body.appendChild(header);
    const section = document.createElement('div'); section.id = 'timelineSection'; document.body.appendChild(section);
    // Mount timeline-lit element to allow initTimeline to render months
    const tl = document.createElement('timeline-lit'); header.appendChild(tl);
    const timeline = await import('../../www/js/components/Timeline.lit.js');
    await timeline.initTimeline();
    // timeline DOM initialized above
    // Prepare source features
    const features = [
      { id: 'F1', title: 'One', type: 'feature', start: '2025-01-01', end: '2025-01-05', project: null, capacity: [] },
      { id: 'F2', title: 'Two', type: 'feature', start: '2025-01-06', end: '2025-01-10', project: null, capacity: [] }
    ];

    // Manually append two lit cards to simulate initial render
    const card1 = document.createElement('feature-card-lit');
    card1.feature = features[0];
    card1.style.left = '10px';
    card1.style.width = '100px';
    board.appendChild(card1);

    const card2 = document.createElement('feature-card-lit');
    card2.feature = features[1];
    card2.style.left = '200px';
    card2.style.width = '120px';
    board.appendChild(card2);

    // Ensure state will return our source features when updateCardsById queries for them
    state._featureService = { getEffectiveFeatureById: (id) => features.find(f => f.id === id) };

    // Now change features and call update; provide precomputed layout values used by tests
    features[0].start = '2025-01-02'; features[0].end = '2025-01-08'; features[0]._left = 50; features[0]._width = 120;
    features[1].start = '2025-01-09'; features[1].end = '2025-01-20'; features[1]._left = 300; features[1]._width = 220;

    // Use the refactored component API
    await board.updateCardsById(['F1','F2'], features);

    // Assert the DOM nodes were patched (style.left/width updated and feature prop set)
    const nodes = board.querySelectorAll('feature-card-lit');
    expect(nodes.length).to.be.at.least(2);
    const n1 = nodes[0];
    expect(n1.feature).to.exist;
    expect(n1.feature.start).to.equal('2025-01-02');
    expect(n1.style.left).to.not.equal('10px');

    const n2 = nodes[1];
    expect(n2.feature.start).to.equal('2025-01-09');
    expect(n2.style.left).to.not.equal('200px');
    // restore ResizeObserver
    if(window.__origResizeObserver){ window.ResizeObserver = window.__origResizeObserver; delete window.__origResizeObserver; }
  });
});
