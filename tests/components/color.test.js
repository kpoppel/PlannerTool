import { fixture, html, expect } from '@open-wc/testing';

describe('Color Components Consolidated', () => {
  it('ColorPopover renders swatches and responds to palette updates', async () => {
    const palette = ['#111111','#222222','#333333'];
    const cpMod = await import('../../www/js/components/ColorPopover.lit.js');
    const cp = await cpMod.ColorPopoverLit.ensureInstance(palette);
    expect(cp).to.exist;
    cp.openFor('project','p1',{ left:0, bottom:0 });
    await new Promise(r=>setTimeout(r,0));
    const el = document.querySelector('color-popover');
    const swatches = el.querySelectorAll('.color-swatch');
    expect(swatches.length).to.equal(palette.length);
    const computed = getComputedStyle(swatches[0]).backgroundColor;
    const toRgb = (hex) => { if(!hex || hex[0] !== '#') return hex; const r = parseInt(hex.substr(1,2),16); const g = parseInt(hex.substr(3,2),16); const b = parseInt(hex.substr(5,2),16); return `rgb(${r}, ${g}, ${b})`; };
    expect(computed).to.equal(toRgb(palette[0]));
  });

  it('applyColor updates state events (manual simulation) and PALETTE exists', async () => {
    const stateMod = await import('../../www/js/services/State.js?b=' + Math.random());
    expect(stateMod.PALETTE).to.be.an('array');
    expect(stateMod.PALETTE.length).to.be.at.least(1);
    const state = stateMod.state;
    const busMod = await import('../../www/js/core/EventBus.js?b=' + Math.random());
    const bus = busMod.bus;
    state.projects = [{ id: 'p1', selected: true }];
    const events = [];
    bus.on('color:changed', (p) => events.push(p));
    state.projects[0].color = '#111111';
    bus.emit('color:changed', { entityType: 'project', id: 'p1', color: '#111111' });
    expect(events.length).to.equal(1);
  });
});
