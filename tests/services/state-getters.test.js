import { expect } from '@esm-bundle/chai';
import { state } from '../../www/js/services/State.js';

describe('State getters coverage small', () => {
  it('invokes simple getters without side-effects', async () => {
    const col = state.getFeatureStateColor('Done');
    expect(col).to.be.a('string');

    const projCol = state.getProjectColor('p1');
    expect(projCol).to.be.a('string');

    const colors = state.getFeatureStateColors();
    expect(colors).to.be.an('object');

    const load = state.computeFeatureOrgLoad({ id: 'f1', teams: [] });
    expect(load).to.be.a('string');
  });
});
