import { expect } from '@open-wc/testing';

describe('Config disable coverage', () => {
  it('calls disable to ensure it is covered', async () => {
    const mod = await import('../../www/js/config.js');
    const { disable, isEnabled } = mod;

    const name = 'COVERAGE_FLAG_DISABLE';
    // make sure disabling a flag results in isEnabled === false
    // and exercises the disable implementation
    disable(name);
    expect(isEnabled(name)).to.equal(false);
  });
});
