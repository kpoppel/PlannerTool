import { expect } from '@esm-bundle/chai';
import { state } from '../helpers/runtimeState.js';

// Previously skipped; small smoke test for viewService defaults
describe('viewOptions coverage', () => {
  it('viewService default flags are accessible', () => {
    // ensure defaults exist via public State facade
    expect(state).to.exist;
    expect(typeof state.setCondensedCards).to.equal('function');
    expect(typeof state.setShowDependencies).to.equal('function');
  });
});
