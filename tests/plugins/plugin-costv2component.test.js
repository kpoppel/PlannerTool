import { expect, fixture, html } from '@open-wc/testing';
import sinon from 'sinon';
import { PluginCostV2Component } from '../../www/js/plugins/PluginCostV2Component.js';

describe('PluginCostV2Component', () => {
  let el;
  beforeEach(async () => {
    el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
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

  it('calls _closeClicked when close button is clicked', async () => {
    const stub = sinon.stub(el, '_closeClicked');
    const closeBtn = el.shadowRoot.querySelector('.close-btn');
    closeBtn.click();
    expect(stub.calledOnce).to.be.true;
    stub.restore();
  });
});
