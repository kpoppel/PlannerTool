import { expect } from '@esm-bundle/chai';
import { PluginStateService } from '../../www/js/services/PluginStateService.js';

describe('PluginStateService', () => {
  let svc;
  let mockBus;
  let mockDataService;

  beforeEach(async () => {
    mockBus = { emit: () => {}, on: () => {}, off: () => {} };
    mockDataService = {};
    svc = new PluginStateService(mockBus, mockDataService);
    await svc.init();
  });

  it('set/get returns deep-cloned state', () => {
    const obj = { a: { b: 1 } };
    svc.set('p1', obj);
    const got = svc.get('p1');
    expect(got).to.deep.equal(obj);
    // mutate original should not affect stored value
    obj.a.b = 2;
    const again = svc.get('p1');
    expect(again.a.b).to.equal(1);
  });

  it('update merges shallowly', () => {
    svc.set('p2', { a: 1, b: 2 });
    svc.update('p2', { b: 3 });
    expect(svc.get('p2').b).to.equal(3);
  });

  it('subscribe receives updates', () => {
    let called = false;
    const unsub = svc.subscribe('p3', (value) => {
      called = true;
      expect(value && value.x).to.equal(5);
    });
    svc.set('p3', { x: 5 });
    expect(called).to.equal(true);
    unsub();
  });

  it('captureForView respects saveToView meta', () => {
    svc.set('p4', { foo: 'bar' }, { saveToView: true });
    svc.set('p5', { secret: 1 }, { saveToView: false });
    const cap = svc.captureForView();
    expect(cap.p4).to.deep.equal({ foo: 'bar' });
    expect(cap.p5).to.be.undefined;
  });

  it('restoreFromView loads provided map', async () => {
    await svc.restoreFromView({ p6: { z: 9 } });
    expect(svc.get('p6')).to.deep.equal({ z: 9 });
  });

  it('restoreFromView replaces persisted entries but preserves session-only state', async () => {
    svc.set('persisted-plugin', { startDate: '2026-01-01' }, { saveToView: true });
    svc.set('session-plugin', { expanded: ['a'] }, { saveToView: false });

    await svc.restoreFromView({
      'other-plugin': { startDate: '2026-02-01' },
    });

    expect(svc.get('persisted-plugin')).to.equal(null);
    expect(svc.get('other-plugin')).to.deep.equal({ startDate: '2026-02-01' });
    expect(svc.get('session-plugin')).to.deep.equal({ expanded: ['a'] });
    expect(svc.captureForView()).to.deep.equal({
      'other-plugin': { startDate: '2026-02-01' },
    });
  });

  it('rejects non-serialisable state (circular)', () => {
    const a = {};
    a.self = a;
    let threw = false;
    try {
      svc.set('p7', a);
    } catch (e) {
      threw = true;
    }
    expect(threw).to.equal(true);
  });
});
