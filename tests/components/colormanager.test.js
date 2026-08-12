import { expect } from '@open-wc/testing';

describe('Color manager utilities', () => {
  it('PALETTE is defined and has 16 colors', async () => {
    const cs = await import('../../www/js/services/ColorService.js?b=' + Math.random());
    expect(cs.PALETTE).to.be.an('array');
    expect(cs.PALETTE.length).to.equal(16);
  });
});
