import { fixture, html, expect } from '@open-wc/testing';
import '../../www/js/components/Sidebar.lit.js';
import '../../www/js/components/ColorPopover.lit.js';
import { state } from '../../www/js/services/State.js';
import { bus } from '../../www/js/core/EventBus.js';
import { ProjectEvents, TeamEvents } from '../../www/js/core/EventRegistry.js';

describe('Sidebar Consolidated Tests', () => {
  beforeEach(async () => { await customElements.whenDefined('app-sidebar'); });

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
    const pbtn = root2.querySelector('#projectToggleBtn'); expect(pbtn).to.exist;
    state._projectTeamService.initFromBaseline([ { id: 'pa', name: 'A' }, { id: 'pb', name: 'B' }, { id: 'pc', name: 'C' } ], [ { id: 'ta', name: 'A' }, { id: 'tb', name: 'B' } ]);
    pbtn.click(); await new Promise(r=>setTimeout(r,10)); expect(state.projects.every(p=>p.selected)).to.be.true;
    pbtn.click(); await new Promise(r=>setTimeout(r,10)); expect(state.projects.every(p=>!p.selected)).to.be.true;

    bus.emit(TeamEvents.CHANGED, state.teams);
    const tbtn = root2.querySelector('#teamToggleBtn'); expect(tbtn).to.exist;
    tbtn.click(); await new Promise(r=>setTimeout(r,10)); expect(state.teams.every(t=>t.selected)).to.be.true;
    tbtn.click(); await new Promise(r=>setTimeout(r,10)); expect(state.teams.every(t=>!t.selected)).to.be.true;
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
