/**
 * Tests for the _drawBezier helper in PluginDependenciesComponent.
 * (Replaces the old dependency-renderer.lit.test.js which tested the removed
 *  DependencyRenderer LitElement.)
 */
import { expect } from '@esm-bundle/chai';
import { PluginDependenciesComponent } from '../../www/js/plugins/PluginDependenciesComponent.js';

describe('PluginDependenciesComponent._drawBezier', () => {
  let inst;

  beforeEach(() => {
    inst = document.createElement('plugin-dependencies');
    // Provide a minimal SVG so _drawBezier can append paths
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    inst._svgEl = svg;
    document.body.appendChild(inst);
  });

  afterEach(() => {
    inst.remove();
  });

  it('appends a path element with a Bezier d attribute', () => {
    const p = inst._drawBezier({ x: 10, y: 10 }, { x: 100, y: 50 }, { dashed: true });
    expect(p).to.exist;
    expect(p.getAttribute('d')).to.include('M 10 10');
    expect(p.getAttribute('stroke-dasharray')).to.exist;
  });

  it('appends a solid path for non-dashed links', () => {
    const p = inst._drawBezier({ x: 5, y: 5 }, { x: 50, y: 50 });
    expect(p).to.exist;
    expect(p.getAttribute('stroke-dasharray')).to.be.null;
  });

  it('clears SVG by setting innerHTML to empty string', () => {
    inst._drawBezier({ x: 0, y: 0 }, { x: 100, y: 100 });
    expect(inst._svgEl.childElementCount).to.equal(1);
    inst._svgEl.innerHTML = '';
    expect(inst._svgEl.childElementCount).to.equal(0);
  });
});
