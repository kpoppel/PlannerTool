import { expect } from '@esm-bundle/chai';
import { initViewOptions } from '../../www/js/components/Sidebar.lit.js';

describe('viewOptions coverage', () => {
  it('initViewOptions builds DOM structure without error', () => {
    const container = document.createElement('div');
    container.id = 'viewOptionsContainer';
    document.body.appendChild(container);
    initViewOptions(container);
    // Should have children added
    expect(container.children.length).to.be.greaterThan(0);
    // cleanup
    container.remove();
  });
});
