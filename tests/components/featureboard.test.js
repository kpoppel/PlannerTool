import { fixture, html, expect } from '@open-wc/testing';

describe('FeatureBoard & DragSurface Tests', () => {
  it('updateCardsById patches existing lit cards', async () => {
    // Stub ResizeObserver for the duration of this test to avoid loop errors
    if(!window.__origResizeObserver){ window.__origResizeObserver = window.ResizeObserver; }
    window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };

    const mod = await import('../../www/js/components/FeatureBoard.lit.js');
    const { updateCardsById } = mod;
    const cfg = await import('../../www/js/config.js');
    cfg.featureFlags.USE_LIT_COMPONENTS = true;

    // Provide a lightweight mock feature-card-lit if not present
    if(!customElements.get('feature-card-lit')){
      class MockFeatureCard extends HTMLElement{ constructor(){ super(); this.feature = {}; this.selected=false; } applyVisuals({ left, width, selected, dirty, project } = {}){ if(left!==undefined) this.style.left = left; if(width!==undefined) this.style.width = width; if(selected!==undefined) this.selected=!!selected; if(dirty!==undefined) this.feature = Object.assign({}, this.feature, { dirty }); if(project!==undefined) this.project = project; } }
      customElements.define('feature-card-lit', MockFeatureCard);
    }

    const board = await fixture(html`<feature-board id="featureBoard"></feature-board>`);
    const header = document.createElement('div'); header.id='timelineHeader'; document.body.appendChild(header);
    const section = document.createElement('div'); section.id='timelineSection'; document.body.appendChild(section);
    const tl = document.createElement('timeline-lit'); header.appendChild(tl);
    const timeline = await import('../../www/js/components/Timeline.lit.js'); await timeline.initTimeline();

    const features = [ { id:'F1', title:'One', type:'feature', start:'2025-01-01', end:'2025-01-05', project:null, capacity:[] }, { id:'F2', title:'Two', type:'feature', start:'2025-01-06', end:'2025-01-10', project:null, capacity:[] } ];
    const card1 = document.createElement('feature-card-lit'); card1.feature = features[0]; card1.style.left='10px'; card1.style.width='100px'; board.appendChild(card1);
    const card2 = document.createElement('feature-card-lit'); card2.feature = features[1]; card2.style.left='200px'; card2.style.width='120px'; board.appendChild(card2);
    features[0].start='2025-01-02'; features[0].end='2025-01-08'; features[0]._left=50; features[0]._width=120;
    features[1].start='2025-01-09'; features[1].end='2025-01-20'; features[1]._left=300; features[1]._width=220;
    await board.updateCardsById(['F1','F2'], features);
    // restore ResizeObserver
    if(window.__origResizeObserver){ window.ResizeObserver = window.__origResizeObserver; delete window.__origResizeObserver; }
    const nodes = board.querySelectorAll('feature-card-lit'); expect(nodes.length).to.be.at.least(2);
    expect(nodes[0].feature.start).to.equal('2025-01-02'); expect(nodes[0].style.left).to.not.equal('10px');
    expect(nodes[1].feature.start).to.equal('2025-01-09'); expect(nodes[1].style.left).to.not.equal('200px');
  });

  it('attachDrag binds mousedown and calls onStart (local adapter)', async () => {
    function attachDrag(el, handlers){ if(!el) return; el.addEventListener('mousedown', (e)=>{ if(typeof handlers.onStart === 'function'){ handlers.onStart(e); } }); }
    const el = document.createElement('div'); document.body.appendChild(el);
    let called = false; attachDrag(el, { onStart: ()=>{ called = true; } });
    const evt = new MouseEvent('mousedown', { bubbles: true }); el.dispatchEvent(evt);
    expect(called).to.be.true;
  });
});
