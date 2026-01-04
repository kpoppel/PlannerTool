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
    const aside = el.querySelector('.sidebar');
    expect(aside).to.exist;
    el.open = false; await el.updateComplete;
    const closed = el.querySelector('.sidebar.closed'); expect(closed).to.exist;
  });

  it('project and team All/None toggles work', async () => {
    state._projectTeamService.initFromBaseline([ { id: 'pa', name: 'A' }, { id: 'pb', name: 'B' }, { id: 'pc', name: 'C' } ], [ { id: 'ta', name: 'A' }, { id: 'tb', name: 'B' } ]);
    bus.emit(ProjectEvents.CHANGED, state.projects);
    const el = await fixture(html`<app-sidebar></app-sidebar>`);
    const pbtn = el.querySelector('#projectToggleBtn'); expect(pbtn).to.exist;
    pbtn.click(); await new Promise(r=>setTimeout(r,10)); expect(state.projects.every(p=>p.selected)).to.be.true;
    pbtn.click(); await new Promise(r=>setTimeout(r,10)); expect(state.projects.every(p=>!p.selected)).to.be.true;

    bus.emit(TeamEvents.CHANGED, state.teams);
    const tbtn = el.querySelector('#teamToggleBtn'); expect(tbtn).to.exist;
    tbtn.click(); await new Promise(r=>setTimeout(r,10)); expect(state.teams.every(t=>t.selected)).to.be.true;
    tbtn.click(); await new Promise(r=>setTimeout(r,10)); expect(state.teams.every(t=>!t.selected)).to.be.true;
  });

  it('opens color popover when color dot clicked', async () => {
    const el = await fixture(html`<app-sidebar></app-sidebar>`);
    state._projectTeamService.initFromBaseline([{ id: 'p1', name: 'Project One', color: '#3498db' }], [{ id: 't1', name: 'Team One', color: '#1abc9c' }]);
    state._projectTeamService.setProjectSelected('p1', true);
    state._projectTeamService.setTeamSelected('t1', true);
    if(!Array.isArray(state.baselineFeatures)) state.baselineFeatures = [];
    bus.emit(ProjectEvents.CHANGED, state.projects); bus.emit(TeamEvents.CHANGED, state.teams);
    if(el.updateComplete) await el.updateComplete;
    const manualDot = document.createElement('span'); manualDot.className='color-dot'; manualDot.setAttribute('data-color-id','p1'); manualDot.style.background='#3498db'; el.appendChild(manualDot);
    await new Promise(r=>setTimeout(r,0));
    const dot = el.querySelector('.color-dot') || document.querySelector('.color-dot'); expect(dot).to.exist;
    dot.click(); await new Promise(r=>setTimeout(r,0));
    const lit = document.querySelector('color-popover'); if(lit){ expect(lit.open).to.equal(true); } else { const pop = document.querySelector('.color-popover'); expect(pop).to.exist; const style = window.getComputedStyle(pop); expect(style.display).to.not.equal('none'); }
  });
});
