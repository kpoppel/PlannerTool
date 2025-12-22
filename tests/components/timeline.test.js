import { expect, fixture, html } from '@open-wc/testing';
import { bus } from '../../www/js/core/EventBus.js';
import '../../www/js/components/Timeline.lit.js';
import { TimelineEvents } from '../../www/js/core/EventRegistry.js';
import { state } from '../../www/js/services/State.js';

describe('Timeline Consolidated Tests', () => {
  it('renders header with month cells and exposes APIs', async () => {
    const months = [ new Date('2025-01-01'), new Date('2025-02-01'), new Date('2025-03-01') ];
    const el = await fixture(html`<timeline-lit .months=${months} .bus=${bus}></timeline-lit>`);
    await el.updateComplete;
    const cells = el.shadowRoot.querySelectorAll('.timeline-cell');
      const header = document.getElementById('timelineHeader') || document.createElement('div'); header.id = 'timelineHeader'; document.body.appendChild(header);
      const section = document.getElementById('timelineSection') || document.createElement('div'); section.id = 'timelineSection'; document.body.appendChild(section);
      expect(cells.length).to.be.at.least(1);
    expect(cells[0].textContent).to.include('Jan');
    expect(el.scrollToMonth).to.be.a('function');
    const totalWidth = el.getTotalWidth(); expect(totalWidth).to.be.a('number');
  });

  it('sets month cell widths correctly and calculates total width', async () => {
    const months = [ new Date('2025-01-01'), new Date('2025-02-01') ];
    const el = await fixture(html`<timeline-lit .months=${months} .monthWidth=${120} .bus=${bus}></timeline-lit>`);
    await el.updateComplete;
    const cell = el.shadowRoot.querySelector('.timeline-cell');
    const computedWidth = parseInt(window.getComputedStyle(cell).width, 10);
      const header = document.getElementById('timelineHeader') || document.createElement('div'); header.id = 'timelineHeader'; document.body.appendChild(header);
      const section = document.getElementById('timelineSection') || document.createElement('div'); section.id = 'timelineSection'; section.style.width = '600px'; document.body.appendChild(section);
      expect(computedWidth).to.be.at.least(120);
    expect(el.getTotalWidth()).to.equal(240);
  });

  it('renderMonths updates DOM and handles empty months', async () => {
    const initialMonths = [ new Date('2025-01-01') ];
    const el = await fixture(html`<timeline-lit .months=${initialMonths} .bus=${bus}></timeline-lit>`);
    await el.updateComplete;
    expect(el.shadowRoot.querySelectorAll('.timeline-cell').length).to.equal(1);
    const newMonths = [ new Date('2025-01-01'), new Date('2025-02-01'), new Date('2025-03-01') ];
    await el.renderMonths(newMonths);
    expect(el.months).to.deep.equal(newMonths);
    expect(el.shadowRoot.querySelectorAll('.timeline-cell').length).to.equal(3);

    const empty = await fixture(html`<timeline-lit .months=${[]} .bus=${bus}></timeline-lit>`);
    await empty.updateComplete;
    expect(empty.shadowRoot.querySelectorAll('.timeline-cell').length).to.equal(0);
  });

  it('computes months and emits MONTHS event via initTimeline', async () => {
    state.getEffectiveFeatures = () => [ { start: '2022-01-05', end: '2022-03-20' } ];
    const header = document.createElement('div'); header.id = 'timelineHeader'; document.body.appendChild(header);
    const section = document.createElement('div'); section.id = 'timelineSection'; section.style.width = '600px'; document.body.appendChild(section);
    const board = document.createElement('div'); board.id = 'featureBoard'; document.body.appendChild(board);
    const { _resetTimelineState, initTimeline } = await import('../../www/js/components/Timeline.lit.js');
    _resetTimelineState();
    const tl = document.createElement('timeline-lit'); header.appendChild(tl);

    await new Promise((resolve, reject) => {
      bus.on(TimelineEvents.MONTHS, (months) => {
        try { expect(months).to.be.an('array'); expect(months.length).to.be.at.least(3); resolve(); } catch (e) { reject(e); }
      });
      initTimeline();
    });

    ['timelineHeader','timelineSection','featureBoard'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
  });
});
