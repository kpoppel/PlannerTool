import { expect, fixture, html } from '@open-wc/testing';
import sinon from 'sinon';
import { PluginCostComponent } from '../../www/js/plugins/PluginCostComponent.js';
import { state } from '../../www/js/services/State.js';

describe('PluginCostComponent', () => {
  let el;
  let originalPluginStateService;
  beforeEach(async () => {
    originalPluginStateService = state._pluginStateService;
    el = await fixture(html`<plugin-cost></plugin-cost>`);
  });

  afterEach(() => {
    state._pluginStateService = originalPluginStateService;
  });

  it('renders toolbar and default view', () => {
    const toolbar = el.shadowRoot.querySelector('.toolbar');
    expect(toolbar).to.exist;
    expect(el.activeView).to.equal('project');
  });

  it('shows loading state when loading', async () => {
    el.loading = true;
    await el.updateComplete;
    const loading = el.shadowRoot.querySelector('.loading');
    expect(loading).to.exist;
  });

  it('shows error state when error is set', async () => {
    el.loading = false;
    el.error = 'Test error';
    await el.updateComplete;
    const error = el.shadowRoot.querySelector('.error');
    expect(error).to.exist;
    expect(error.textContent).to.include('Test error');
  });

  it('switches views when tab buttons are clicked', async () => {
    const buttons = el.shadowRoot.querySelectorAll('.tab-buttons button');
    buttons[1].click(); // Task View
    await el.updateComplete;
    expect(el.activeView).to.equal('task');
    buttons[2].click(); // Team View
    await el.updateComplete;
    expect(el.activeView).to.equal('team');
    buttons[3].click(); // Team Members
    await el.updateComplete;
    expect(el.activeView).to.equal('team-members');
  });

  it('calls loadData on open()', async () => {
    const stub = sinon.stub(el, 'loadData');
    el.open();
    expect(stub.calledOnce).to.be.true;
    stub.restore();
  });

  it('calls handleViewModeChange and updates viewMode', async () => {
    el.activeView = 'team';
    await el.updateComplete;
    const costBtn = el.shadowRoot.querySelector('.view-toggle button');
    costBtn.click();
    await el.updateComplete;
    expect(el.viewMode).to.equal('cost');
  });

  it('calls handleDateChange on date input change', async () => {
    el.activeView = 'project';
    await el.updateComplete;
    const startInput = el.shadowRoot.querySelector('#start-date');
    startInput.value = '2025-01-01';
    startInput.dispatchEvent(new Event('change'));
    await el.updateComplete;
    expect(el.startDate).to.equal('2025-01-01');
  });

  it('persists date range into pluginStateService while still open', () => {
    const updateStub = sinon.stub();
    const loadDataStub = sinon.stub(el, 'loadData');
    state._pluginStateService = { update: updateStub };

    el.startDate = '2026-03-01';
    el.endDate = '2026-04-30';
    el.handleDateChange();

    expect(updateStub.calledOnce).to.be.true;
    expect(updateStub.firstCall.args[0]).to.equal('plugin-cost');
    expect(updateStub.firstCall.args[1]).to.deep.equal({
      startDate: '2026-03-01',
      endDate: '2026-04-30',
    });
    expect(updateStub.firstCall.args[2]).to.deep.equal({ saveToView: true });
    loadDataStub.restore();
  });

  it('applies restored plugin state while already open', async () => {
    let subscriber;
    const unsubscribe = sinon.stub();

    el.remove();
    state._pluginStateService = {
      subscribe: (pluginId, cb) => {
        expect(pluginId).to.equal('plugin-cost');
        subscriber = cb;
        return unsubscribe;
      },
    };

    el = await fixture(html`<plugin-cost></plugin-cost>`);
    const loadDataStub = sinon.stub(el, 'loadData');
    el.setAttribute('visible', '');

    subscriber({
      startDate: '2026-06-01',
      endDate: '2026-08-31',
    });

    expect(el.startDate).to.equal('2026-06-01');
    expect(el.endDate).to.equal('2026-08-31');
    expect(loadDataStub.calledOnce).to.be.true;
    loadDataStub.restore();
  });

  it('calls _closeClicked when close button is clicked', async () => {
    const stub = sinon.stub(el, '_closeClicked');
    const closeBtn = el.shadowRoot.querySelector('.close-btn');
    closeBtn.click();
    expect(stub.calledOnce).to.be.true;
    stub.restore();
  });
});
