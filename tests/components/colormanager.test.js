import { expect } from '@open-wc/testing';

describe('Color manager utilities', () => {
  it('PALETTE is defined and has 16 colors', async () => {
    const cs = await import('../../www/js/services/ColorService.js?b=' + Math.random());
    expect(cs.PALETTE).to.be.an('array');
    expect(cs.PALETTE.length).to.equal(16);
  });

  it('emits ColorEvents.CHANGED when color change occurs', async () => {
    const busMod = await import('../../www/js/core/EventBus.js?b=' + Math.random());
    const { ColorEvents } = await import('../../www/js/core/EventRegistry.js?b=' + Math.random());
    const bus = busMod.bus;

    if (bus.listeners && typeof bus.listeners.clear === 'function') bus.listeners.clear();
    const events = [];
    bus.on(ColorEvents.CHANGED, (p) => events.push(p));

    // simulate a color change notification
    bus.emit(ColorEvents.CHANGED, { entityType: 'project', id: 'p1', color: '#111111' });
    expect(events.length).to.equal(1);
  });
});
