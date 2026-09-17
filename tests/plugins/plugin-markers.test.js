import { expect } from '@open-wc/testing';
import { stub } from 'sinon';
import { vi } from 'vitest';
import PluginMarkers from '../../www/js/plugins/PluginMarkers.js';
import { PluginMarkersComponent } from '../../www/js/plugins/PluginMarkersComponent.js';
import { bus } from '../../www/js/core/EventBus.js';
import { PluginEvents, TimelineEvents } from '../../www/js/core/EventRegistry.js';

const mockSel = vi.hoisted(() => ({
  selection: {
    getSelectedProjectIds: vi.fn(() => []),
    getSelectedTeamIds: vi.fn(() => []),
  },
  scope: {
    getVisibleTeams: vi.fn(() => []),
    getTeamDrilldownIds: vi.fn(() => []),
  },
}));

vi.mock('../../www/js/application/imports.js', () => ({
  sel: mockSel,
}));

describe('PluginMarkers', () => {
  let emitStub;

  beforeEach(() => {
    emitStub = stub(bus, 'emit');
  });

  afterEach(() => {
    emitStub.restore();
  });

  it('activates, deactivates, and destroys cleanly', async () => {
    const plugin = new PluginMarkers('markers-test');
    plugin._componentLoaded = true;
    plugin._host = { appendChild: stub() };
    plugin._el = {
      open: stub(),
      close: stub(),
      remove: stub(),
      style: { display: 'none' },
    };

    await plugin.activate();
    expect(plugin.active).to.be.true;
    expect(emitStub.calledOnce).to.be.true;
    expect(emitStub.firstCall.args[0]).to.equal(PluginEvents.ACTIVATED);

    await plugin.deactivate();
    expect(plugin.active).to.be.false;
    expect(emitStub.calledTwice).to.be.true;
    expect(emitStub.secondCall.args[0]).to.equal(PluginEvents.DEACTIVATED);

    await plugin.destroy();
    expect(plugin._el).to.equal(null);
    expect(plugin.active).to.be.false;
  });
});

describe('PluginMarkersComponent marker filtering', () => {
  afterEach(() => {
    mockSel.selection.getSelectedProjectIds.mockReset();
    mockSel.selection.getSelectedTeamIds.mockReset();
  });

  it('renders filtered marker counts from selector-backed project and team ids', async () => {
    mockSel.selection.getSelectedProjectIds.mockReturnValue(['proj-A']);
    mockSel.selection.getSelectedTeamIds.mockReturnValue(['team-1']);
    mockSel.scope.getTeamDrilldownIds.mockReturnValue(['team-1']);

    const el = document.createElement('plugin-markers');
    el.visible = true;
    el.markers = [
      {
        project: 'proj-A',
        team_id: 'team-1',
        plan_id: 'plan-1',
        plan_name: 'Plan 1',
        marker: { date: '2026-01-01', label: 'M1', color: '#ff0000' },
      },
      {
        project: 'proj-A',
        team_id: 'team-2',
        plan_id: 'plan-2',
        plan_name: 'Plan 2',
        marker: { date: '2026-02-01', label: 'M2', color: '#00ff00' },
      },
      {
        project: 'proj-B',
        team_id: null,
        plan_id: 'plan-3',
        plan_name: 'Plan 3',
        marker: { date: '2026-03-01', label: 'M3', color: '#0000ff' },
      },
    ];

    document.body.appendChild(el);
    await el.updateComplete;

    expect(el.shadowRoot.textContent.replace(/\s+/g, ' ').trim()).to.include(
      '1 of 3 markers'
    );

    el.remove();
  });

  it('uses canonical visible teams when filtering marker counts', async () => {
    mockSel.selection.getSelectedProjectIds.mockReturnValue(['proj-A']);
    mockSel.selection.getSelectedTeamIds.mockReturnValue(['team-1']);
    mockSel.scope.getTeamDrilldownIds.mockReturnValue(['team-2']);

    const el = document.createElement('plugin-markers');
    el.visible = true;
    el.markers = [{
      project: 'proj-A',
      team_id: 'team-1',
      plan_id: 'plan-1',
      marker: { date: '2026-01-01', label: 'M1' },
    }];

    document.body.appendChild(el);
    await el.updateComplete;

    expect(el.shadowRoot.querySelector('.marker-count').textContent).to.include('0');
    el.remove();
  });

  it('refreshes when the canonical timeline-month event is emitted', () => {
    const el = new PluginMarkersComponent();
    const scheduleRender = stub(el, '_scheduleRender');

    el.connectedCallback();
    bus.emit(TimelineEvents.MONTHS);

    expect(scheduleRender.called).to.be.true;
    el.disconnectedCallback();
  });
});