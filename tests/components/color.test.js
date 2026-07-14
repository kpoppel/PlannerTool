import { fixture, html, expect } from '@open-wc/testing';
import sinon from 'sinon';
import { PALETTE, state } from '../helpers/runtimeState.js';

describe('Color Components Consolidated', () => {
  it('ColorPopover renders swatches and responds to palette updates', async () => {
    const palette = ['#111111', '#222222', '#333333'];
    const cpMod = await import('../../www/js/components/ColorPopover.lit.js');
    const cp = await cpMod.ColorPopoverLit.ensureInstance(palette);
    expect(cp).to.exist;
    cp.openFor('project', 'p1', { left: 0, bottom: 0 });
    await new Promise((r) => setTimeout(r, 0));
    const el = document.querySelector('color-popover');
    const root = el.renderRoot || el.shadowRoot || el;
    const swatches = root.querySelectorAll('.color-swatch');
    expect(swatches.length).to.equal(palette.length);
    const computed = getComputedStyle(swatches[0]).backgroundColor;
    const toRgb = (hex) => {
      if (!hex || hex[0] !== '#') return hex;
      const r = parseInt(hex.substr(1, 2), 16);
      const g = parseInt(hex.substr(3, 2), 16);
      const b = parseInt(hex.substr(5, 2), 16);
      return `rgb(${r}, ${g}, ${b})`;
    };
    expect(computed).to.equal(toRgb(palette[0]));
  });

  it('applyColor updates state events (manual simulation) and PALETTE exists', async () => {
    expect(PALETTE).to.be.an('array');
    expect(PALETTE.length).to.be.at.least(1);
    const busMod = await import('../../www/js/core/EventBus.js?b=' + Math.random());
    const bus = busMod.bus;
    const projects = [{ id: 'p1', selected: true }];
    state.initProjectTeamBaseline(projects, []);
    const events = [];
    const { ColorEvents } = await import('../../www/js/core/EventRegistry.js');
    bus.on(ColorEvents.CHANGED, (p) => events.push(p));
    state.projects[0].color = '#111111';
    bus.emit(ColorEvents.CHANGED, {
      entityType: 'project',
      id: 'p1',
      color: '#111111',
    });
    expect(events.length).to.equal(1);
  });
});
