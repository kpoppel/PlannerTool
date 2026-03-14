import { expect } from '@esm-bundle/chai';
import { state } from '../../www/js/services/State.js';

// Previously skipped; small smoke test for viewService defaults
describe('viewOptions coverage', () => {
  it('viewService default flags are accessible', () => {
    // ensure defaults exist on state._viewService
    expect(state._viewService).to.exist;
    expect(typeof state._viewService.setCondensedCards).to.equal('function');
    expect(typeof state._viewService.setShowDependencies).to.equal('function');
  });
});
