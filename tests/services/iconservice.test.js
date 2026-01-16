import { expect } from '@open-wc/testing';
import { epicSvgElement, featureSvgElement } from '../../../www/js/services/IconService.js';

describe('IconService', () => {
  it('creates epic svg element and sets attributes', () => {
    const el = epicSvgElement({ x: 10, y: 20, width: 48, height: 48 });
    expect(el).to.exist;
    expect(el.tagName.toLowerCase()).to.equal('svg');
    expect(el.getAttribute('x')).to.equal('10');
    expect(el.getAttribute('y')).to.equal('20');
    expect(el.getAttribute('width')).to.equal('48');
    expect(el.getAttribute('height')).to.equal('48');
  });

  it('creates feature svg element without attributes', () => {
    const el = featureSvgElement();
    expect(el).to.exist;
    expect(el.tagName.toLowerCase()).to.equal('svg');
  });
});
