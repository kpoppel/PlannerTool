import { expect } from '@open-wc/testing';

/**
 * Consolidated EventBus + EventRegistry tests
 */

describe('EventBus: Consolidated Behavior and Features', () => {
  let bus;
  beforeEach(async () => {
    const module = await import('../../www/js/core/EventBus.js');
    bus = module.bus;
    // clear internals
    if (bus.listeners && typeof bus.listeners.clear === 'function') bus.listeners.clear();
    if (bus.eventTypeMap && typeof bus.eventTypeMap.clear === 'function') bus.eventTypeMap.clear();
    bus.history = [];
    if (typeof bus.disableStringWarnings === 'function') bus.disableStringWarnings();
    if (typeof bus.disableHistoryLogging === 'function') bus.disableHistoryLogging();
  });

  it('should emit and receive symbol events', (done) => {
    const testPayload = { value: 42 };
    const EV = Symbol('test:event');

    bus.on(EV, (payload) => {
      expect(payload).to.deep.equal(testPayload);
      done();
    });

    bus.emit(EV, testPayload);
  });

  it('should support multiple listeners for same event', () => {
    let count = 0;

    const EV = Symbol('test:event');
    bus.on(EV, () => count++);
    bus.on(EV, () => count++);
    bus.on(EV, () => count++);

    bus.emit(EV, {});

    expect(count).to.equal(3);
  });

  it('should return unsubscribe function from on()', () => {
    let received = false;

    const EV = Symbol('test:event');
    const unsubscribe = bus.on(EV, () => {
      received = true;
    });

    expect(unsubscribe).to.be.a('function');

    unsubscribe();
    bus.emit(EV, {});

    expect(received).to.be.false;
  });

  it('should isolate errors in event handlers', () => {
    let secondHandlerCalled = false;

    const EV = Symbol('test:event');
    bus.on(EV, () => {
      throw new Error('Handler error');
    });
    bus.on(EV, () => {
      secondHandlerCalled = true;
    });

    // Should not throw
    expect(() => {
      bus.emit(EV, {});
    }).to.not.throw();

    expect(secondHandlerCalled).to.be.true;
  });

  it('should handle events with no listeners gracefully', () => {
    expect(() => {
      bus.emit(Symbol('nonexistent:event'), { data: 'test' });
    }).to.not.throw();
  });

  it('should emit FeatureEvents.UPDATED with symbol', async () => {
    const { FeatureEvents } = await import('../../www/js/core/EventRegistry.js');
    const events = [];
    bus.on(FeatureEvents.UPDATED, (payload) => events.push(payload));
    bus.emit(FeatureEvents.UPDATED, { id: 1 });
    expect(events.length).to.equal(1);
    expect(events[0]).to.deep.equal({ id: 1 });
  });

  it('warns when subscribing with string event when enabled', async () => {
    // String subscriptions are no longer supported; ensure they throw
    if (typeof bus.enableStringWarnings === 'function') bus.enableStringWarnings();
    expect(() => bus.on('legacy:event', () => {})).to.throw(Error);
  });

  it('records history when enabled', async () => {
    if (typeof bus.enableHistoryLogging === 'function') bus.enableHistoryLogging(10);
    const EV = Symbol('some:event');
    bus.emit(EV, { a: 1 });
    const hist = (typeof bus.getEventHistory === 'function') ? bus.getEventHistory() : bus.history;
    expect(hist.length).to.equal(1);
    expect(hist[0].event).to.equal(EV);
    expect(hist[0].payload).to.deep.equal({ a: 1 });
  });

  it('wildcard listeners receive events', () => {
    const received = [];
    bus.onNamespace('data', (p) => received.push(p));
    bus.emit(Symbol('data:one'), 1);
    bus.emit(Symbol('data:two'), 2);
    expect(received).to.deep.equal([1,2]);
  });
});


describe('Enhanced EventBus Features', () => {
  let bus;
  beforeEach(async () => {
    const module = await import('../../www/js/core/EventBus.js');
    bus = module.bus;
    bus.listeners.clear();
    if (bus.eventTypeMap) {
      bus.eventTypeMap.clear();
    }
  });

  describe('Backward Compatibility', () => {
    it('should handle symbol events', (done) => {
      const payload = { data: 'test' };
      const EV = Symbol('test:event');

      bus.on(EV, (received) => {
        expect(received).to.deep.equal(payload);
        done();
      });

      bus.emit(EV, payload);
    });

    it('should still return unsubscribe function for string events', () => {
      let called = false;

      const EV = Symbol('test:event');
      const unsubscribe = bus.on(EV, () => {
        called = true;
      });

      unsubscribe();
      bus.emit(EV, {});

      expect(called).to.be.false;
    });
  });

  describe('Typed Events', () => {
    it('should register typed event mapping (no-op) and handle symbol events', () => {
      const TypedEvent = Symbol('test:typed');

      // registerEventType is a compatibility no-op
      bus.registerEventType(TypedEvent, 'test:typed');

      // ensure symbol mapping works for subscriptions
      let seen = false;
      bus.on(TypedEvent, (payload) => { seen = payload.value === 42; });
      bus.emit(TypedEvent, { value: 42 });
      expect(seen).to.be.true;
    });
  });

  describe('Wildcard Support', () => {
    it('should trigger wildcard listener for matching events', async () => {
      let count = 0;

      bus.onNamespace('feature', () => count++);

      const FEAT = await import('../../www/js/core/EventRegistry.js');
      bus.emit(FEAT.FeatureEvents.CREATED, {});
      bus.emit(FEAT.FeatureEvents.UPDATED, {});
      bus.emit(FEAT.FeatureEvents.DELETED, {});

      expect(count).to.equal(3);
    });

    it('should not trigger wildcard for non-matching namespace', () => {
      let count = 0;

      bus.onNamespace('feature', () => count++);

      bus.emit(Symbol('scenario:created'), {});
      bus.emit(Symbol('project:updated'), {});

      expect(count).to.equal(0);
    });

    it('should trigger both exact and wildcard listeners', async () => {
      let exactCount = 0;
      let wildcardCount = 0;

      const FEAT = await import('../../www/js/core/EventRegistry.js');
      bus.on(FEAT.FeatureEvents.CREATED, () => exactCount++);
      bus.onNamespace('feature', () => wildcardCount++);

      bus.emit(FEAT.FeatureEvents.CREATED, {});

      expect(exactCount).to.equal(1);
      expect(wildcardCount).to.equal(1);
    });

    it('should unsubscribe from wildcard listeners', async () => {
      let count = 0;

      const unsubscribe = bus.onNamespace('feature', () => count++);

      const FEAT = await import('../../www/js/core/EventRegistry.js');
      bus.emit(FEAT.FeatureEvents.CREATED, {});
      unsubscribe();
      bus.emit(FEAT.FeatureEvents.UPDATED, {});

      expect(count).to.equal(1);
    });

    it('should pass payload to wildcard listeners', async () => {
      const { FeatureEvents } = await import('../../www/js/core/EventRegistry.js');
      const ev = new Promise((resolve) => bus.onNamespace('feature', resolve));
      bus.emit(FeatureEvents.CREATED, { id: '123' });
      const payload = await ev;
      expect(payload.id).to.equal('123');
    });
  });

  describe('Error Handling', () => {
    it('should handle unregistered typed events gracefully', () => {
      const UnknownEvent = Symbol('unknown:event');

      expect(() => {
        bus.emit(UnknownEvent, {});
      }).to.not.throw();
    });

    it('should convert unregistered symbol to string', () => {
      const UnknownEvent = Symbol('unknown:event');
      let received = false;

      // Listen on the namespace via onNamespace
      bus.onNamespace('unknown', () => { received = true; });

      bus.emit(UnknownEvent, {});

      expect(received).to.be.true;
    });
  });
});
