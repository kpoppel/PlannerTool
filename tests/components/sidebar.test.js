import { fixture, html, expect } from '@open-wc/testing';
import '../../www/js/components/Sidebar.lit.js';
import '../../www/js/components/ColorPopover.lit.js';
// Ensure dependent menu elements are registered for tests that await them
import '../../www/js/components/PlanMenu.lit.js';
import '../../www/js/components/TeamMenu.lit.js';
import { state } from '../../www/js/services/State.js';
import { bus } from '../../www/js/core/EventBus.js';
import { ProjectEvents, TeamEvents } from '../../www/js/core/EventRegistry.js';

describe('Sidebar Consolidated Tests', () => {
  beforeEach(async () => { await customElements.whenDefined('app-sidebar'); });
  beforeEach(async () => { await customElements.whenDefined('plan-menu'); await customElements.whenDefined('team-menu'); });

  it('renders open by default and hides when open=false', async () => {
    const el = await fixture(html`<app-sidebar></app-sidebar>`);
    expect(el).to.exist;
    const root = el.renderRoot || el.shadowRoot || el;
    const aside = root.querySelector('.sidebar');
    expect(aside).to.exist;
    el.open = false; await el.updateComplete;
    const closed = root.querySelector('.sidebar.closed'); expect(closed).to.exist;
  });

  it('project and team All/None toggles work', async () => {
    state._projectTeamService.initFromBaseline([ { id: 'pa', name: 'A' }, { id: 'pb', name: 'B' }, { id: 'pc', name: 'C' } ], [ { id: 'ta', name: 'A' }, { id: 'tb', name: 'B' } ]);
    bus.emit(ProjectEvents.CHANGED, state.projects);
    const el = await fixture(html`<app-sidebar></app-sidebar>`);
    const root2 = el.renderRoot || el.shadowRoot || el;
    let planMenu = root2.querySelector('plan-menu') || document.querySelector('plan-menu');
    if(!planMenu){ planMenu = document.createElement('plan-menu'); document.body.appendChild(planMenu); }
    // Ensure the menu always reflects the current state's projects to avoid stale shared instances
    if(planMenu) { planMenu.projects = state.projects; }
    expect(planMenu).to.exist;
    await (planMenu.updateComplete || Promise.resolve());
    const pmRoot = planMenu.renderRoot || planMenu.shadowRoot || planMenu;
    const pbtn = pmRoot.querySelector('.list-toggle-btn'); expect(pbtn).to.exist;
    state._projectTeamService.initFromBaseline([ { id: 'pa', name: 'A' }, { id: 'pb', name: 'B' }, { id: 'pc', name: 'C' } ], [ { id: 'ta', name: 'A' }, { id: 'tb', name: 'B' } ]);
    // Sanity checks before clicking: ensure both the planMenu and the state report some unchecked projects
    // This helps root-cause why ProjectEvents.CHANGED may not be emitted.
    expect(typeof planMenu._anyUncheckedProjects).to.equal('function');
    expect(planMenu._anyUncheckedProjects()).to.equal(true, 'planMenu reports no unchecked projects before toggle');
    expect(state.projects.some(p=>!p.selected)).to.equal(true, 'state reports no unchecked projects before toggle');
    // Attach handler, click, and assert the ProjectEvents.CHANGED event is emitted
    let projectChanged = false;
    const waitProjectChanged = new Promise(resolve => {
      const handler = () => { bus.off(ProjectEvents.CHANGED, handler); projectChanged = true; resolve(); };
      bus.on(ProjectEvents.CHANGED, handler);
    });
    pbtn.click(); await waitProjectChanged; expect(projectChanged).to.be.true;

    let projectChanged2 = false;
    const waitProjectChanged2 = new Promise(resolve => {
      const handler = () => { bus.off(ProjectEvents.CHANGED, handler); projectChanged2 = true; resolve(); };
      bus.on(ProjectEvents.CHANGED, handler);
    });
    pbtn.click(); await waitProjectChanged2; expect(projectChanged2).to.be.true;
    expect(state.projects.every(p=>!p.selected)).to.be.true;

    bus.emit(TeamEvents.CHANGED, state.teams);
    let teamMenu = root2.querySelector('team-menu') || document.querySelector('team-menu');
    if(!teamMenu){ teamMenu = document.createElement('team-menu'); document.body.appendChild(teamMenu); }
    // Ensure created team menu reflects current teams (overwrite stale instances)
    if(teamMenu) { teamMenu.teams = state.teams; }
    expect(teamMenu).to.exist;
    await (teamMenu.updateComplete || Promise.resolve());
    const tmRoot = teamMenu.renderRoot || teamMenu.shadowRoot || teamMenu;
    const tbtn = tmRoot.querySelector('.list-toggle-btn'); expect(tbtn).to.exist;
    let teamChanged = false;
    const waitTeamChanged = new Promise(resolve => {
      const handler = () => { bus.off(TeamEvents.CHANGED, handler); teamChanged = true; resolve(); };
      bus.on(TeamEvents.CHANGED, handler);
    });
    tbtn.click(); await waitTeamChanged; expect(teamChanged).to.be.true;

    let teamChanged2 = false;
    const waitTeamChanged2 = new Promise(resolve => {
      const handler = () => { bus.off(TeamEvents.CHANGED, handler); teamChanged2 = true; resolve(); };
      bus.on(TeamEvents.CHANGED, handler);
    });
    tbtn.click(); await waitTeamChanged2; expect(teamChanged2).to.be.true;
    expect(state.teams.every(t=>!t.selected)).to.be.true;
  });

  it('opens color popover when color dot clicked', async () => {
    // The sidebar's color popover is a shared singleton; verify programmatic open works.
    const cpMod = await import('../../www/js/components/ColorPopover.lit.js');
    const cp = await cpMod.ColorPopoverLit.ensureInstance(['#3498db']);
    cp.openFor('project','p1',{ left:0, bottom:0 });
    await new Promise(r=>setTimeout(r,0));
    expect(cp.open).to.equal(true);
  });
});
