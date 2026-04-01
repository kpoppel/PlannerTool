import { expect } from '@esm-bundle/chai';
import { vi } from 'vitest';
import {
  Timeline,
  _resetTimelineState,
  getTimelineMonths,
} from '../../www/js/components/Timeline.lit.js';

describe('Timeline component unit tests', () => {
  it('_resetTimelineState clears months cache', () => {
    _resetTimelineState();
    const months = getTimelineMonths();
    expect(Array.isArray(months)).to.equal(true);
    expect(months.length).to.equal(0);
  });

  it('renderMonths sets months, emits months via bus and computes total width', async () => {
    // ensure custom element is registered
    if (!customElements.get('timeline-lit')) {
      await import('../../www/js/components/Timeline.lit.js');
    }
    const el = document.createElement('timeline-lit');
    const mockBus = { emit: vi.fn() };
    el.bus = mockBus;
    el.monthWidth = 50;
    document.body.appendChild(el);

    const months = [new Date(2025, 0, 1), new Date(2025, 1, 1), new Date(2025, 2, 1)];
    await el.renderMonths(months);
    expect(el.months.length).to.equal(3);
    // verify bus.emit was invoked at least once
    expect(
      mockBus.emit && mockBus.emit.mock && mockBus.emit.mock.calls.length
    ).to.be.greaterThan(0);
    expect(el.getTotalWidth()).to.equal(150);

    const s = el.scrollToMonth(2);
    expect(s).to.have.property('scrollLeft');
    expect(s.scrollLeft).to.equal(100);

    el.remove();
  });
});
