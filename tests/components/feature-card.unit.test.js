import { expect, fixture } from '@open-wc/testing';
import '../../www/js/components/FeatureCard.lit.js';

describe('FeatureCardLit basic behaviors', () => {
  it('constructor defaults and basic render', async () => {
    const el = await fixture('<feature-card-lit></feature-card-lit>');
    expect(el.feature).to.be.an('object');
    el.feature = {
      id: 'f1',
      title: 'My Feature',
      start: '2025-01-01',
      end: '2025-01-10',
    };
    el.project = { color: '#123456' };
    await el.updateComplete;
    const root = el.shadowRoot.querySelector('.feature-card');
    expect(root).to.exist;
    expect(root.textContent).to.include('My Feature');
    expect(root.textContent).to.include('2025-01-01');
  });

  it('applyVisuals updates styles and selection', async () => {
    const el = await fixture('<feature-card-lit></feature-card-lit>');
    el.feature = { id: 'f2', title: 'Another' };
    await el.updateComplete;
    el.applyVisuals({
      left: 100,
      width: 200,
      selected: true,
      dirty: true,
      project: { color: '#abc' },
    });
    await el.updateComplete;
    expect(el.style.left).to.equal('100px');
    expect(el.style.width).to.equal('200px');
    const root = el.shadowRoot.querySelector('.feature-card');
    expect(root.classList.contains('selected')).to.be.true;
    expect(el.classList.contains('dirty')).to.be.true;
  });

  it('splitTitleAtMiddle splits long titles and escapeHtml', async () => {
    const el = document.createElement('feature-card-lit');
    const long = 'This is a reasonably long feature title for testing split';
    const split = el._splitTitleAtMiddle(long);
    expect(split).to.include('<br/>');
    const escaped = el._escapeHtml('<bad>&"');
    expect(escaped).to.equal('&lt;bad&gt;&amp;&quot;');
  });

  it('setLiveDates toggles live/default date DOM nodes', async () => {
    const el = await fixture('<feature-card-lit></feature-card-lit>');
    el.feature = { id: 'f3', title: 'Dates', start: '2025-02-01', end: '2025-02-05' };
    await el.updateComplete;
    el.setLiveDates('2025-02-02 → 2025-02-03');
    await el.updateComplete;
    const dates = el.shadowRoot.querySelector('.feature-dates');
    expect(dates.querySelector('.dates-live').textContent).to.include('2025-02-02');
    el.clearLiveDates();
    await el.updateComplete;
    expect(dates.querySelector('.dates-live').textContent).to.equal('');
  });
});
