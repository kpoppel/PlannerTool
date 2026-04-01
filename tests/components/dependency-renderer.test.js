/**
 * Tests for PluginDependenciesComponent
 * (formerly DependencyRenderer.lit.js — now a proper plugin)
 */
import { expect } from '@open-wc/testing';
import { PluginDependenciesComponent } from '../../www/js/plugins/PluginDependenciesComponent.js';
import { state } from '../../www/js/services/State.js';
import { bus } from '../../www/js/core/EventBus.js';
import { FeatureEvents } from '../../www/js/core/EventRegistry.js';

/**
 * The global 00-setup.test.js creates:
 *
 *   <timeline-board>
 *     <feature-board id="feature-board">
 *       shadowRoot:
 *         <div id="feature-board-host">
 *           <feature-card-lit data-feature-id="1"> (left:10, top:10)
 *           <feature-card-lit data-feature-id="2"> (left:160, top:10)
 *           <feature-card-lit data-feature-id="3"> (left:320, top:10)
 *
 * OverlaySvgPlugin._attachOverlay() needs findInBoard('#board-area') to succeed.
 * We inject a #board-area div into the existing timeline-board in beforeEach and
 * remove it in afterEach so the global setup isn't permanently modified.
 */

describe('PluginDependenciesComponent', () => {
  let component;
  let boardArea;

  beforeEach(() => {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    // Inject #board-area into the global timeline-board so _attachOverlay can find it
    const timelineBoard = document.querySelector('timeline-board');
    if (timelineBoard && !timelineBoard.querySelector('#board-area')) {
      boardArea = document.createElement('div');
      boardArea.id = 'board-area';
      boardArea.style.position = 'relative';
      timelineBoard.appendChild(boardArea);
    } else {
      boardArea = document.querySelector('#board-area');
    }
  });

  afterEach(() => {
    component?.remove();
    component = null;
    // Remove only the #board-area we injected (not a permanent fixture)
    boardArea?.remove();
    boardArea = null;
  });

  // Helper: get the feature-board host inner from the global setup
  function getHostInner() {
    const featureBoard = document.querySelector('feature-board');
    if (!featureBoard?.shadowRoot) return null;
    return featureBoard.shadowRoot.querySelector('#feature-board-host') || featureBoard.shadowRoot;
  }

  it('draws a Bezier path between two feature cards', async () => {
    // Uses cards 1 and 2 from the global setup (left:10,top:10 and left:160,top:10)
    state.getEffectiveFeatures = () => [
      { id: 1, relations: [2] },
      { id: 2, relations: [] },
    ];
    state._viewService.setShowDependencies(true);

    component = document.createElement('plugin-dependencies');
    document.body.appendChild(component);
    await component.updateComplete;

    component.open();
    bus.emit(FeatureEvents.UPDATED);
    await new Promise((r) => setTimeout(r, 100));

    const svg = boardArea?.querySelector('.dependencies-overlay__svg');
    expect(svg).to.exist;
    expect(svg.querySelectorAll('path').length).to.be.at.least(1);
  });

  it('renders predecessor, successor and related paths with correct styles', async () => {
    state.getEffectiveFeatures = () => [
      { id: 1, relations: [2, { id: 3, type: 'Successor' }] },
      { id: 2, relations: [{ id: 3, type: 'Related' }] },
      { id: 3, relations: [] },
    ];
    state._viewService.setShowDependencies(true);

    component = document.createElement('plugin-dependencies');
    document.body.appendChild(component);
    await component.updateComplete;

    component.open();
    bus.emit(FeatureEvents.UPDATED);
    await new Promise((r) => setTimeout(r, 100));

    const svg = boardArea?.querySelector('.dependencies-overlay__svg');
    expect(svg).to.exist;
    const paths = svg.querySelectorAll('path');
    expect(paths.length).to.be.at.least(2);

    let dashed = 0;
    paths.forEach((p) => { if (p.getAttribute('stroke-dasharray')) dashed++; });
    expect(dashed).to.be.greaterThan(0);
  });

  it('clears the SVG when showDependencies is toggled off', async () => {
    state.getEffectiveFeatures = () => [
      { id: 1, relations: [2] },
      { id: 2, relations: [] },
    ];
    state._viewService.setShowDependencies(true);

    component = document.createElement('plugin-dependencies');
    document.body.appendChild(component);
    await component.updateComplete;

    component.open();
    await new Promise((r) => setTimeout(r, 50));

    state._viewService.setShowDependencies(false);
    component._handleDepsToggle();
    await new Promise((r) => setTimeout(r, 50));

    const svg = boardArea?.querySelector('.dependencies-overlay__svg');
    expect(svg).to.exist;
    expect(svg.querySelectorAll('path').length).to.equal(0);
  });
});
