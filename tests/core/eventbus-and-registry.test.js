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

  it('should emit and receive string events', (done) => {
    const testPayload = { value: 42 };

    bus.on('test:event', (payload) => {
      expect(payload).to.deep.equal(testPayload);
      done();
    });

    bus.emit('test:event', testPayload);
  });

  it('should support multiple listeners for same event', () => {
    let count = 0;

    bus.on('test:event', () => count++);
    bus.on('test:event', () => count++);
    bus.on('test:event', () => count++);

    bus.emit('test:event', {});

    expect(count).to.equal(3);
  });

  it('should return unsubscribe function from on()', () => {
    let received = false;

    const unsubscribe = bus.on('test:event', () => {
      received = true;
    });

    expect(unsubscribe).to.be.a('function');

    unsubscribe();
    bus.emit('test:event', {});

    expect(received).to.be.false;
  });

  it('should isolate errors in event handlers', () => {
    let secondHandlerCalled = false;

    bus.on('test:event', () => {
      throw new Error('Handler error');
    });

    bus.on('test:event', () => {
      secondHandlerCalled = true;
    });

    // Should not throw
    expect(() => {
      bus.emit('test:event', {});
    }).to.not.throw();

    expect(secondHandlerCalled).to.be.true;
  });

  it('should handle events with no listeners gracefully', () => {
    expect(() => {
      bus.emit('nonexistent:event', { data: 'test' });
    }).to.not.throw();
  });

  it('registerEventTypes should allow symbol mapping and emit with symbol', async () => {
    const reg = await import('../../www/js/core/EventRegistry.js');
    reg.registerEventTypes(bus);
    const events = [];
    bus.on(reg.FeatureEvents.UPDATED, (payload) => events.push(payload));
    bus.emit(reg.FeatureEvents.UPDATED, { id: 1 });
    expect(events.length).to.equal(1);
    expect(events[0]).to.deep.equal({ id: 1 });
  });

  it('warns when subscribing with string event when enabled', async () => {
    let warned = false;
    const orig = console.warn;
    console.warn = (msg) => {
      if (typeof msg === 'string' && msg.includes('Subscribing with string event')) warned = true;
    };
    try {
      if (typeof bus.enableStringWarnings === 'function') bus.enableStringWarnings();
      bus.on('legacy:event', () => {});
      expect(warned).to.equal(true);
    } finally {
      console.warn = orig;
    }
  });

  it('records history when enabled', async () => {
    if (typeof bus.enableHistoryLogging === 'function') bus.enableHistoryLogging(10);
    bus.emit('some:event', { a: 1 });
    const hist = (typeof bus.getEventHistory === 'function') ? bus.getEventHistory() : bus.history;
    expect(hist.length).to.equal(1);
    expect(hist[0].event).to.equal('some:event');
    expect(hist[0].payload).to.deep.equal({ a: 1 });
  });

  it('wildcard listeners receive events', () => {
    const received = [];
    bus.on('data:*', (p) => received.push(p));
    bus.emit('data:one', 1);
    bus.emit('data:two', 2);
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
    it('should still handle string events', (done) => {
      const payload = { data: 'test' };

      bus.on('test:event', (received) => {
        expect(received).to.deep.equal(payload);
        done();
      });

      bus.emit('test:event', payload);
    });

    it('should still return unsubscribe function for string events', () => {
      let called = false;

      const unsubscribe = bus.on('test:event', () => {
        called = true;
      });

      unsubscribe();
      bus.emit('test:event', {});

      expect(called).to.be.false;
    });
  });

  describe('Typed Events', () => {
    it('should register typed event mapping', () => {
      const TypedEvent = Symbol('test:typed');

      bus.registerEventType(TypedEvent, 'test:typed');

      expect(bus.eventTypeMap.has(TypedEvent)).to.be.true;
      expect(bus.eventTypeMap.get(TypedEvent)).to.equal('test:typed');
    });

    it('should emit typed event and receive via string listener', (done) => {
      const TypedEvent = Symbol('test:typed');
      bus.registerEventType(TypedEvent, 'test:typed');

      bus.on('test:typed', (payload) => {
        expect(payload.value).to.equal(42);
        done();
      });

      bus.emit(TypedEvent, { value: 42 });
    });

    it('should emit string event and receive via typed listener', (done) => {
      const TypedEvent = Symbol('test:typed');
      bus.registerEventType(TypedEvent, 'test:typed');

      bus.on(TypedEvent, (payload) => {
        expect(payload.value).to.equal(42);
        done();
      });

      bus.emit('test:typed', { value: 42 });
    });

    it('should support typed event for both emit and subscribe', (done) => {
      const TypedEvent = Symbol('test:typed');
      bus.registerEventType(TypedEvent, 'test:typed');

      bus.on(TypedEvent, (payload) => {
        expect(payload.value).to.equal(42);
        done();
      });

      bus.emit(TypedEvent, { value: 42 });
    });
  });

  describe('Wildcard Support', () => {
    it('should trigger wildcard listener for matching events', () => {
      let count = 0;

      bus.on('feature:*', () => count++);

      bus.emit('feature:created', {});
      bus.emit('feature:updated', {});
      bus.emit('feature:deleted', {});

      expect(count).to.equal(3);
    });

    it('should not trigger wildcard for non-matching namespace', () => {
      let count = 0;

      bus.on('feature:*', () => count++);

      bus.emit('scenario:created', {});
      bus.emit('project:updated', {});

      expect(count).to.equal(0);
    });

    it('should trigger both exact and wildcard listeners', () => {
      let exactCount = 0;
      let wildcardCount = 0;

      bus.on('feature:created', () => exactCount++);
      bus.on('feature:*', () => wildcardCount++);

      bus.emit('feature:created', {});

      expect(exactCount).to.equal(1);
      expect(wildcardCount).to.equal(1);
    });

    it('should unsubscribe from wildcard listeners', () => {
      let count = 0;

      const unsubscribe = bus.on('feature:*', () => count++);

      bus.emit('feature:created', {});
      unsubscribe();
      bus.emit('feature:updated', {});

      expect(count).to.equal(1);
    });

    it('should pass payload to wildcard listeners', (done) => {
      bus.on('feature:*', (payload) => {
        expect(payload.id).to.equal('123');
        done();
      });

      bus.emit('feature:created', { id: '123' });
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

      // Listen on the string representation
      bus.on('Symbol(unknown:event)', () => {
        received = true;
      });

      bus.emit(UnknownEvent, {});

      expect(received).to.be.true;
    });
  });
});
