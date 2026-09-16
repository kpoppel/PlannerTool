import { expect, fixture } from '@open-wc/testing';
import sinon from 'sinon';
import '../../www/js/components/FeatureCard.lit.js';
import { cmd } from '../../www/js/application/imports.js';

describe('FeatureCardLit basic behaviors', () => {
  afterEach(() => {
    sinon.restore();
  });

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

  it('reverts the scenario override when the card is double-clicked', async () => {
    const revertFeature = sinon.stub(cmd.feature, 'revertFeature');
    const el = await fixture('<feature-card-lit></feature-card-lit>');
    el.feature = { id: 'f4', title: 'Reset me', start: '2025-02-01', end: '2025-02-05' };
    await el.updateComplete;

    el.shadowRoot.querySelector('.feature-card').dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, composed: true })
    );

    expect(revertFeature.calledOnceWithExactly('f4')).to.be.true;
  });

  it('renders deselected team allocations as dimmed badges', async () => {
    const el = await fixture('<feature-card-lit></feature-card-lit>');
    el.feature = {
      id: 'f5',
      title: 'Shared allocation',
      capacity: [
        { team: 't1', capacity: '30%' },
        { team: 't2', capacity: '40%' },
      ],
    };
    el.teams = [
      { id: 't1', name: 'Selected team', color: '#111111', selected: true },
      { id: 't2', name: 'Deselected team', color: '#222222', selected: false },
    ];
    await el.updateComplete;

    const teamBadges = el.shadowRoot.querySelectorAll('.team-load-box:not(:first-child)');
    expect(teamBadges).to.have.lengthOf(2);
    expect(teamBadges[0].classList.contains('team-load-box--dimmed')).to.be.false;
    expect(teamBadges[1].classList.contains('team-load-box--dimmed')).to.be.true;
    expect(teamBadges[1].textContent.trim()).to.equal('40%');
  });

  it('renders ghost title text with initial card render', async () => {
    const el = await fixture('<feature-card-lit></feature-card-lit>');
    el.feature = {
      id: 'f4',
      title: 'This is a long feature title for ghost rendering',
      start: '2025-01-01',
      end: '2025-01-10',
    };
    el.style.width = '120px';
    await el.updateComplete;

    const ghostText =
      el.shadowRoot.querySelector('.ghost-title .ghost-title-text')?.textContent || '';
    const normalized = ghostText.replace(/\s+/g, '').trim();
    expect(normalized).to.include('Thisisalongfeaturetitleforghostrendering');
  });

  it('recalculates ghost visibility when packed mode suppresses ghost titles', async () => {
    const el = await fixture('<feature-card-lit></feature-card-lit>');
    el.feature = { id: 'f6', title: 'Packed title' };
    await el.updateComplete;
    const requestLayout = sinon.spy(el, '_requestLayout');

    el.hideGhostTitle = true;
    await el.updateComplete;

    expect(requestLayout).to.have.been.calledOnce;
  });
});
