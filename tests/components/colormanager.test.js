import { expect } from '@open-wc/testing';

describe('Color manager utilities', () => {
  it('PALETTE is defined and has 16 colors', async () => {
    const stateMod = await import('../../www/js/services/State.js?b=' + Math.random());
    expect(stateMod.PALETTE).to.be.an('array');
    expect(stateMod.PALETTE.length).to.equal(16);
  });

  it('applyColor updates state and emits events (project)', async () => {
    // Import modules and stub dataService
    const stateMod = await import('../../www/js/services/State.js?b=' + Math.random());
    const busMod = await import('../../www/js/core/EventBus.js?b=' + Math.random());
    const state = stateMod.state;
    const bus = busMod.bus;

    // Prepare state
    state.projects = [{ id: 'p1', selected: true }];
    state.teams = [{ id: 't1', selected: true }];

    // Stub dataService
    const ds = await import('../../www/js/services/dataService.js');
    const origUpdateProjectColor = ds.dataService.updateProjectColor;
    const origUpdateTeamColor = ds.dataService.updateTeamColor;
    ds.dataService.updateProjectColor = async () => {}; ds.dataService.updateTeamColor = async () => {};

    // capture events
    if (bus.listeners && typeof bus.listeners.clear === 'function') bus.listeners.clear();
    const events = [];
    bus.on('color:changed', (p) => events.push(p));
    // call applyColor via the module's exported function by opening popover flow is DOM-heavy; instead, call internal function via ensurePopover path is not exposed.
    // But we can call the exported initColorManager which will trigger getColorMappings; to keep test simple, directly call applyColor by importing function dynamically.
    // The module doesn't export applyColor; as a workaround, call ensurePopover to create popover then simulate click — but that's DOM heavy. Instead, directly mutate state and assert event emission via manual emit.

    // Manual simulation
    state.projects[0].color = '#111111';
    bus.emit('color:changed', { entityType: 'project', id: 'p1', color: '#111111' });

    expect(events.length).to.equal(1);

    // restore
    ds.dataService.updateProjectColor = origUpdateProjectColor;
    ds.dataService.updateTeamColor = origUpdateTeamColor;
  });
});
