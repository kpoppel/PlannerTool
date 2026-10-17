import { expect, fixture } from '@open-wc/testing';
import sinon from 'sinon';
import '../../www/js/components/FeatureCard.lit.js';
import { cmd, sel } from '../../www/js/application/imports.js';

describe('FeatureCardLit basic behaviors', () => {
  it('offers two named resize zones and locks the whole handle color until cancellation', async () => {
    sinon.stub(sel.scenario, 'isActiveScenarioMutable').returns(true);
    const el = await fixture('<feature-card-lit style="width:200px"></feature-card-lit>');
    el.feature = { id: 'resize', title: 'Resize', start: '2026-10-05', end: '2026-10-16' };
    await el.updateComplete;
    const zones = el.shadowRoot.querySelectorAll('.resize-zone');
    expect(zones.length).to.equal(2);
    expect(zones[0].getAttribute('aria-label')).to.include('Keep allocation');
    expect(zones[1].getAttribute('aria-label')).to.include('Keep effort');
    zones[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true,
      button: 0, clientX: 100 }));
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.drag-handle').getAttribute('data-active-policy'))
      .to.equal('keep-effort');
    zones[0].dispatchEvent(new MouseEvent('mouseenter'));
    expect(el._resizePolicy).to.equal('keep-effort');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.drag-handle').getAttribute('data-active-policy')).to.equal('');
  });

  it('explains a resize zone after a delay and clears the tooltip on leave', async () => {
    sinon.stub(sel.scenario, 'isActiveScenarioMutable').returns(true);
    const el = await fixture('<feature-card-lit></feature-card-lit>');
    const clock = sinon.useFakeTimers();
    try {
      const zone = el.shadowRoot.querySelector('.resize-zone');
      zone.dispatchEvent(new MouseEvent('mouseenter'));
      clock.tick(649);
      await el.updateComplete;
      expect(el.shadowRoot.querySelector('[role="tooltip"]')).to.be.null;
      clock.tick(1);
      await el.updateComplete;
      expect(el.shadowRoot.querySelector('[role="tooltip"]').textContent).to.include('effort changes');
      zone.dispatchEvent(new MouseEvent('mouseleave'));
      await el.updateComplete;
      expect(el.shadowRoot.querySelector('[role="tooltip"]')).to.be.null;
    } finally {
      clock.restore();
    }
  });

  it('resizes from the keyboard using the focused zone policy', async () => {
    sinon.stub(sel.scenario, 'isActiveScenarioMutable').returns(true);
    sinon.stub(sel.feature, 'getEffectiveFeatures').returns([]);
    const resize = sinon.stub(cmd.feature, 'resizeFeatureDates').returns([]);
    const el = await fixture('<feature-card-lit></feature-card-lit>');
    el.feature = { id: 'key', title: 'Keyboard', start: '2026-10-05', end: '2026-10-16' };
    await el.updateComplete;
    el.shadowRoot.querySelector('[data-resize-policy="keep-allocation"]')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(resize.calledOnceWithExactly([{ id: 'key', start: '2026-10-05', end: '2026-10-17' }],
      'keep-allocation')).to.be.true;
  });

  it('omits resize handles and ignores revert gestures when scenario access denies editing', async () => {
    sinon.stub(sel.scenario, 'isActiveScenarioMutable').returns(false);
    const revert = sinon.stub(cmd.feature, 'revertFeature');
    const el = await fixture('<feature-card-lit></feature-card-lit>');
    expect(el.shadowRoot.querySelector('.drag-handle')).to.be.null;
    el._handleDoubleClick({ composedPath: () => [] });
    expect(revert.called).to.be.false;
  });

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

  it('does not render a date label for an unplanned card', async () => {
    const el = await fixture('<feature-card-lit></feature-card-lit>');
    el.feature = { id: 'unplanned', title: 'Unplanned work', start: null, end: null };
    await el.updateComplete;

    expect(el.shadowRoot.querySelector('.dates-default').textContent.trim()).to.equal('');
    expect(el.shadowRoot.querySelector('.feature-dates').textContent).not.to.include('null');
    expect(el.constructor.styles.cssText).to.match(
      /\.feature-dates\s*\{[^}]*min-height:\s*1em;/
    );
  });

  it('resolves completion using the task process and type, not its state label alone', async () => {
    const category = sinon.stub(sel.filter, 'getFeatureStateCategory').returns('Completed');
    const el = await fixture('<feature-card-lit></feature-card-lit>');
    el.feature = { id: 'closed', process_id: 'process', type: 'Feature', state: 'Closed',
      title: 'Delivered', start: '2026-01-01', end: '2026-01-02' };
    await el.updateComplete;
    expect(category.lastCall.args[0]).to.equal(el.feature);
    expect(el.shadowRoot.querySelector('.feature-card').classList.contains('completed')).to.be.true;
  });

  it('labels ancestor context cards as partial hierarchy without changing ordinary cards', async () => {
    const el = await fixture('<feature-card-lit></feature-card-lit>');
    el.feature = { id: 'ancestor', title: 'Ancestor item', ancestorOnly: true,
      childrenComplete: false, start: '2026-01-01', end: '2026-02-01' };
    await el.updateComplete;
    const badge = el.shadowRoot.querySelector('.ancestor-context');
    expect(badge).to.exist;
    expect(badge.textContent.trim()).to.equal('Ancestor');
    expect(badge.getAttribute('title')).to.include('Other child branches are not loaded');
    el.feature = { ...el.feature, ancestorOnly: false, childrenComplete: true };
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.ancestor-context')).to.be.null;
  });

  it('renders anchor presentations as completed historical cards, not ghosted unplanned cards', async () => {
    const el = await fixture('<feature-card-lit></feature-card-lit>');
    el.feature = {
      id: 'historical',
      title: 'Closed unscheduled work',
      state: 'Closed',
      start: null,
      end: null,
      presentation: {
        renderType: 'anchor', date: '2026-05-19', reason: 'completed-unscheduled',
        sourceState: 'Closed',
      },
    };
    await el.updateComplete;

    const card = el.shadowRoot.querySelector('.feature-card');
    expect(card.classList.contains('historical-anchor')).to.be.true;
    expect(card.classList.contains('ghosted')).to.be.false;
    expect(el.shadowRoot.querySelector('.feature-dates').textContent).to.include('2026-05-19');

    el.feature = { ...el.feature, start: '2026-05-19', end: '2026-05-20' };
    await el.updateComplete;
    expect(card.classList.contains('historical-anchor')).to.be.false;
    expect(card.classList.contains('ghosted')).to.be.false;

    el.feature = { ...el.feature, start: null, end: null, state: 'Active' };
    await el.updateComplete;
    expect(card.classList.contains('historical-anchor')).to.be.false;
    expect(card.classList.contains('ghosted')).to.be.true;
  });

  it('shows a keyboard-accessible fold control only for parents and emits a toggle', async () => {
    const el = await fixture('<feature-card-lit></feature-card-lit>');
    el.feature = { id: 'parent', title: 'Parent task', start: '2025-01-01', end: '2025-01-05' };
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.fold-toggle')).to.be.null;

    el.foldCount = 3;
    await el.updateComplete;
    const button = el.shadowRoot.querySelector('.fold-toggle');
    const card = el.shadowRoot.querySelector('.feature-card');
    expect(card.contains(button)).to.be.true;
    expect(card.classList.contains('has-children')).to.be.true;
    expect(button.getAttribute('aria-expanded')).to.equal('true');
    expect(button.getAttribute('aria-label')).to.include('3 tasks');
    let requestedId;
    el.addEventListener('feature-fold-toggle', (event) => { requestedId = event.detail.featureId; });
    button.click();
    expect(requestedId).to.equal('parent');

    el.folded = true;
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.fold-toggle').getAttribute('aria-expanded')).to.equal('false');
    expect(card.querySelector('.fold-toggle .fold-count').textContent).to.equal('3');
    expect(button.firstElementChild.classList.contains('fold-chevron')).to.be.true;
    expect(button.lastElementChild.classList.contains('fold-count')).to.be.true;
    el.foldCount = 1;
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.fold-toggle').getAttribute('aria-label')).to.include('1 task under');
    expect(el.shadowRoot.querySelector('.fold-count').getAttribute('title')).to.equal('1 task hidden');
  });

  it('does not clip the fold control on narrow or small parent cards', async () => {
    const el = await fixture('<feature-card-lit></feature-card-lit>');
    el.feature = { id: 'parent', title: 'Parent task', start: '2025-01-01', end: '2025-01-05' };
    el.foldCount = 2;
    await el.updateComplete;
    const card = el.shadowRoot.querySelector('.feature-card');
    expect(card.classList.contains('has-children')).to.be.true;
    expect(el.constructor.styles.cssText).to.match(
      /\.feature-card\.narrow\.has-children,\s*\.feature-card\.small-feature\.has-children\s*\{[^}]*overflow:\s*visible;/
    );
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
    sinon.stub(sel.scenario, 'isActiveScenarioMutable').returns(true);
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
        { team: 't1', capacity: 30.1 },
        { team: 't2', capacity: 0.01 },
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
    expect(teamBadges[0].textContent.trim()).to.equal('31');
    expect(teamBadges[1].textContent.trim()).to.equal('1');
    expect(teamBadges[1].title).to.equal('Deselected team: 1');
    expect(el.feature.capacity[1].capacity).to.equal(0.01);
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
