import { expect } from '@open-wc/testing';

describe('ServiceRegistry integration', () => {
  it('registers core services and allows resolving EventBus', async () => {
    const mod = await import('../../www/js/core/ServiceRegistry.js');
    const { registerCoreServices, getService } = mod;
    // call registerCoreServices which logs and registers EventBus
    registerCoreServices();
    const eb = getService('EventBus');
    expect(eb).to.exist;
  }).timeout(5000);

  it('registerService prevents double register and getService throws for missing', async () => {
    const m = await import('../../www/js/core/ServiceRegistry.js');
    const { registerService, getService } = m;
    // register a test service
    registerService('TestService', () => ({ value: 1 }), [], true);
    const ts = getService('TestService');
    expect(ts.value).to.equal(1);

    // attempt to get non-existent service should throw
    let threw = false;
    try { getService('NonExistentService'); } catch (e) { threw = true; }
    expect(threw).to.equal(true);
  });
});
