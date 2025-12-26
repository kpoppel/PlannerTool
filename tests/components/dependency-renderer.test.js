import { fixture, html, expect } from '@open-wc/testing';
import { initDependencyRenderer } from '../../www/js/components/DependencyRenderer.lit.js';
import { state } from '../../www/js/services/State.js';
import { bus } from '../../www/js/core/EventBus.js';
import { FeatureEvents } from '../../www/js/core/EventRegistry.js';

describe('DependencyRenderer Consolidated Tests', () => {
  beforeEach(() => {
    if(!window.__origResizeObserver){ window.__origResizeObserver = window.ResizeObserver; }
    window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
  });

  afterEach(() => {
    if(window.__origResizeObserver){ window.ResizeObserver = window.__origResizeObserver; delete window.__origResizeObserver; }
    const board = document.getElementById('featureBoard'); if(board) board.remove();
    const layer = document.getElementById('dependencyLayer'); if(layer) layer.remove();
  });

  it('legacy renderer draws path between styled legacy cards', async () => {
    const board = document.createElement('feature-board'); board.id = 'featureBoard'; board.style.position = 'relative'; board.style.width = '800px'; board.style.height = '400px'; document.body.appendChild(board);
    const a = await fixture(html`<feature-card-lit></feature-card-lit>`);
    const b = await fixture(html`<feature-card-lit></feature-card-lit>`);
    a.setAttribute('data-feature-id','A'); b.setAttribute('data-feature-id','B');
    a.style.position = 'absolute'; a.style.left='10px'; a.style.top='20px'; a.style.width='100px'; a.style.height='40px';
    b.style.position = 'absolute'; b.style.left='200px'; b.style.top='20px'; b.style.width='100px'; b.style.height='40px';
    board.appendChild(a); board.appendChild(b);
    state.showDependencies = true; state.condensedCards = false; state.getEffectiveFeatures = () => [ { id: 'A', relations: ['B'] }, { id: 'B', relations: [] } ];
    initDependencyRenderer();
    bus.emit(FeatureEvents.UPDATED);
    await new Promise(r => setTimeout(r, 300));
    const layer = document.getElementById('dependencyLayer');
    expect(layer).to.exist;
    const paths = layer.querySelectorAll('path');
    expect(paths.length).to.be.at.least(1);
  });

  it('draws a dependency path between lit-host feature cards', async () => {
    state.baselineFeatures = [ { id: 1001 }, { id: 1002 } ];
    state.getEffectiveFeatures = () => [ { id: 1001, relations: [1002] }, { id: 1002, relations: [] } ];
    state.baselineProjects = [];
    state.showDependencies = true;
    initDependencyRenderer();

    const board = document.createElement('feature-board'); board.id = 'featureBoard'; board.style.width = '800px'; board.style.height = '400px'; document.body.appendChild(board);
    const a = await fixture(html`<feature-card-lit></feature-card-lit>`);
    const b = await fixture(html`<feature-card-lit></feature-card-lit>`);
    a.setAttribute('data-feature-id', '1001'); b.setAttribute('data-feature-id', '1002');
    a.style.position = 'absolute'; a.style.left = '50px'; a.style.top = '50px';
    b.style.position = 'absolute'; b.style.left = '300px'; b.style.top = '150px';
    board.appendChild(a); board.appendChild(b);
    await new Promise(r => setTimeout(r, 300));
    const svg = board.querySelector('svg');
    expect(svg).to.exist;
    const path = svg.querySelector('path');
    expect(path).to.exist;
  });

  it('renders predecessor, successor and related paths with styles', async () => {
    state.baselineFeatures = [ { id: 1 }, { id: 2 }, { id: 3 } ];
    state.getEffectiveFeatures = () => [
      { id: 1, relations: [2, { id:3, type: 'Successor' }] },
      { id: 2, relations: [{ id:3, type: 'Related' }] },
      { id: 3, relations: [] }
    ];
    state.showDependencies = true;
    initDependencyRenderer();
    const board = document.createElement('feature-board'); board.id = 'featureBoard'; board.style.width = '800px'; board.style.height = '400px'; document.body.appendChild(board);
    const a = await fixture(html`<feature-card-lit data-feature-id="1" style="position:absolute;left:20px;top:20px;width:80px;height:40px"></feature-card-lit>`);
    const b = await fixture(html`<feature-card-lit data-feature-id="2" style="position:absolute;left:200px;top:60px;width:80px;height:40px"></feature-card-lit>`);
    const c = await fixture(html`<feature-card-lit data-feature-id="3" style="position:absolute;left:400px;top:120px;width:80px;height:40px"></feature-card-lit>`);
    board.appendChild(a); board.appendChild(b); board.appendChild(c);
    await new Promise(r => setTimeout(r, 300));
    const svg = board.querySelector('svg'); expect(svg).to.exist;
    const paths = svg.querySelectorAll('path'); expect(paths.length).to.be.at.least(2);
    let dashed = 0; paths.forEach(p=>{ if(p.getAttribute('stroke-dasharray')) dashed++; });
    expect(dashed).to.be.greaterThan(0);
    board.remove();
  });
});
