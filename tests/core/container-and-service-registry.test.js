import { expect } from '@open-wc/testing';

describe('Container & ServiceRegistry: Consolidated Tests', () => {
  let registerCoreServices;
  let getService;
  let featureFlags;

  beforeEach(async () => {
    const registryModule = await import('../../www/js/core/ServiceRegistry.js');
    const configModule = await import('../../www/js/config.js');

    registerCoreServices = registryModule.registerCoreServices;
    getService = registryModule.getService;
    featureFlags = configModule.featureFlags;

    const { container } = await import('../../www/js/core/Container.js');
    container.reset();
  });

  it('should register EventBus as singleton', () => {
    registerCoreServices();

    const bus1 = getService('EventBus');
    const bus2 = getService('EventBus');

    expect(bus1).to.exist;
    expect(bus1).to.equal(bus2);
    expect(bus1).to.have.property('emit');
    expect(bus1).to.have.property('on');
  });

  it('should return same EventBus instance as global bus', async () => {
    const eventBusModule = await import('../../www/js/core/EventBus.js');
    const globalBus = eventBusModule.bus;

    registerCoreServices();
    const containerBus = getService('EventBus');

    expect(containerBus).to.equal(globalBus);
  });

  it('should log registered services to console', () => {
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(' '));
      originalLog(...args);
    };

    try {
      registerCoreServices();

      const containerLog = logs.find(log => log.includes('[Container] Core services registered'));
      expect(containerLog).to.exist;
      expect(containerLog).to.include('EventBus');
    } finally {
      console.log = originalLog;
    }
  });

  it('should warn when registering duplicate service', async () => {
    const { registerService } = await import('../../www/js/core/ServiceRegistry.js');
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
      warnings.push(args.join(' '));
      originalWarn(...args);
    };

    try {
      registerService('TestService', () => ({ name: 'test' }));
      registerService('TestService', () => ({ name: 'test2' }));

      const warning = warnings.find(w => w.includes('[Container] Service already registered: TestService'));
      expect(warning).to.exist;
    } finally {
      console.warn = originalWarn;
    }
  });

  it('should throw error when resolving non-existent service', () => {
    registerCoreServices();

    expect(() => getService('NonExistentService'))
      .to.throw('Service not registered: NonExistentService');
  });

  it('should allow EventBus to emit events after container initialization', () => {
    registerCoreServices();
    const bus = getService('EventBus');

    let received = false;
    let payload = null;

    bus.on('test:container:event', (data) => {
      received = true;
      payload = data;
    });

    bus.emit('test:container:event', { message: 'Hello from container' });

    expect(received).to.be.true;
    expect(payload).to.deep.equal({ message: 'Hello from container' });
  });
});
