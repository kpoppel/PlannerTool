import { expect } from '@esm-bundle/chai';
import { ProviderREST } from '../../www/js/services/providerREST.js';

describe('ProviderREST /api/markers tests', () => {
  it('getMarkers returns an array of markers with expected fields', async () => {
    const pr = new ProviderREST();
    const markers = await pr.getMarkers();
    expect(Array.isArray(markers)).to.equal(true);
    // markers fixture contains at least one item
    expect(markers.length).to.be.at.least(1);

    const m = markers[0];
    expect(m).to.have.property('plan_id');
    expect(m).to.have.property('plan_name');
    expect(m).to.have.property('marker');
    expect(m.marker).to.have.property('date');
    expect(m.marker).to.have.property('label');
    expect(m.marker).to.have.property('color');
    expect(m).to.have.property('project');
  });
});
