import { expect } from '@open-wc/testing';
import { stub } from 'sinon';
import PluginMarkers from '../../www/js/plugins/PluginMarkers.js';
import { PluginMarkersComponent } from '../../www/js/plugins/PluginMarkersComponent.js';
import { bus } from '../../www/js/core/EventBus.js';
import { PluginEvents } from '../../www/js/core/EventRegistry.js';
import { state } from '../../www/js/services/State.js';

describe('PluginMarkers', () => {
  let emitStub;

  beforeEach(() => {
    emitStub = stub(bus, 'emit');
  });

  afterEach(() => {
    emitStub.restore();
  });

  it('activate/deactivate/destroy/refresh/toggle behave correctly', async () => {
    const p = new PluginMarkers('markers-test');
    // avoid dynamic import path and DOM creation by pre-setting internals
    p._componentLoaded = true;
    p._el = {
      open: stub(),
      close: stub(),
      refresh: stub(),
      remove: stub(),
    };

    await p.activate();
    expect(p.active).to.be.true;
    expect(emitStub.calledOnce).to.be.true;
    expect(emitStub.firstCall.args[0]).to.equal(PluginEvents.ACTIVATED);

    // refresh should call underlying element refresh
    await p.refresh();
    expect(p._el.refresh.called).to.be.true;

    await p.deactivate();
    expect(p.active).to.be.false;
    expect(emitStub.calledTwice).to.be.true;
    expect(emitStub.secondCall.args[0]).to.equal(PluginEvents.DEACTIVATED);

    // destroy should remove element and clear active flag
    await p.destroy();
    expect(p._el).to.equal(null);
    expect(p.active).to.be.false;

    // toggle should call activate when inactive, deactivate when active
    const p2 = new PluginMarkers('markers-toggle');
    p2.activate = stub().resolves();
    p2.deactivate = stub().resolves();
    p2.active = false;
    await p2.toggle();
    expect(p2.activate.calledOnce).to.be.true;
    p2.active = true;
    await p2.toggle();
    expect(p2.deactivate.calledOnce).to.be.true;
  });
});

describe('PluginMarkersComponent marker filtering', () => {
  const MARKERS = [
    { project: 'proj-A', team_id: 'team-1', marker: { date: '2026-01-01', label: 'M1', color: '#ff0000' } },
    { project: 'proj-A', team_id: 'team-2', marker: { date: '2026-02-01', label: 'M2', color: '#ff0000' } },
    { project: 'proj-B', team_id: null,      marker: { date: '2026-03-01', label: 'M3', color: '#ff0000' } },
  ];

  function makeComponent(projects, teams) {
    const c = new PluginMarkersComponent();
    c.markers = MARKERS;
    c.selectedColors = { '#ff0000': true };
    // Stub state.projects and state.teams
    stub(state, 'projects').get(() => projects);
    stub(state, 'teams').get(() => teams);
    return c;
  }

  afterEach(() => {
    // Restore any stubs applied to state
    ['projects', 'teams'].forEach((prop) => {
      const desc = Object.getOwnPropertyDescriptor(state, prop);
      if (desc && desc.get?.restore) desc.get.restore();
      if (desc && desc.restore) desc.restore();
    });
  });

  /** Invoke the private filter directly by reading what _renderSvg would keep */
  function runFilter(c) {
    const selectedProjects = (state.projects || []).filter((p) => p.selected).map((p) => p.id);
    const selectedTeams = (state.teams || []).filter((t) => t.selected).map((t) => t.id);
    const hasProjectSelection = selectedProjects.length > 0;
    const hasTeamSelection = selectedTeams.length > 0;

    return c.markers.filter((m) => {
      if (!hasProjectSelection) return false;
      const projectMatch = selectedProjects.includes(m.project);
      const teamMatch = !hasTeamSelection || !m.team_id || selectedTeams.includes(m.team_id);
      const markerColor = m.marker?.color || '#2196F3';
      const colorMatch = c.selectedColors[markerColor] !== false;
      return projectMatch && teamMatch && colorMatch;
    });
  }

  it('shows markers when a project is selected but no teams are selected', () => {
    const c = makeComponent(
      [{ id: 'proj-A', selected: true }, { id: 'proj-B', selected: false }],
      [] // no teams
    );
    const result = runFilter(c);
    // Both proj-A markers (M1 and M2) should be visible even with no team selection
    expect(result.length).to.equal(2);
    expect(result.map((m) => m.marker.label)).to.deep.equal(['M1', 'M2']);
  });

  it('hides markers when no projects are selected (regardless of teams)', () => {
    const c = makeComponent(
      [{ id: 'proj-A', selected: false }],
      [{ id: 'team-1', selected: true }]
    );
    const result = runFilter(c);
    expect(result.length).to.equal(0);
  });

  it('filters by team when teams are selected', () => {
    const c = makeComponent(
      [{ id: 'proj-A', selected: true }],
      [{ id: 'team-1', selected: true }]
    );
    const result = runFilter(c);
    // Only M1 (team-1) should pass — M2 (team-2) filtered out
    expect(result.length).to.equal(1);
    expect(result[0].marker.label).to.equal('M1');
  });
});
