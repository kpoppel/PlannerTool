import { expect } from '@esm-bundle/chai';
import '../../www/js/components/DependencyRenderer.lit.js';

describe('dependency-renderer', () => {
  let inst;
  beforeEach(() => {
    // create a bare dependency-renderer element
    inst = document.createElement('dependency-renderer');
    document.body.appendChild(inst);
  });

  afterEach(() => {
    inst.remove();
  });

  it('drawLine appends a path element to internal svg', () => {
    // ensure firstUpdated created svg
    inst.firstUpdated && inst.firstUpdated();
    const p = inst.drawLine({x:10,y:10},{x:100,y:50}, { dashed:true });
    expect(p).to.exist;
    expect(p.getAttribute('d')).to.include('M 10 10');
  });

  it('clear removes svg children', () => {
    inst.firstUpdated && inst.firstUpdated();
    inst.drawLine({x:5,y:5},{x:15,y:15});
    inst.clear();
    const svg = inst._svg;
    expect(svg.childElementCount).to.equal(0);
  });
});
