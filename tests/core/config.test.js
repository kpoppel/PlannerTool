import { expect } from '@open-wc/testing';

describe('Config feature flags', () => {
  it('enable and disable modify flags as expected', async () => {
    const mod = await import('../../www/js/config.js');
    const { isEnabled, enable, disable } = mod;

    // ensure a flag is not enabled
    const name = 'TEST_DYNAMIC_FLAG';
    disable(name);
    expect(isEnabled(name)).to.equal(false);

    enable(name);
    expect(isEnabled(name)).to.equal(true);

    disable(name);
    expect(isEnabled(name)).to.equal(false);
  });

  it('respects runtime overrides when imported after setting window.__featureFlags', async () => {
    // set runtime override before importing a fresh module instance
    window.__featureFlags = { RUNTIME_FLAG: true };
    const mod = await import('../../www/js/config.js?reload=1');
    const { isEnabled } = mod;
    expect(isEnabled('RUNTIME_FLAG')).to.equal(true);
    // cleanup
    delete window.__featureFlags;
  });
});
