/**
 * Integration tests for PluginCostV2Component
 * Tests component rendering, view switching, and user interactions
 */

import { expect, fixture, html } from '@open-wc/testing';
import '../../www/js/plugins/PluginCostV2Component.js';
import { pluginManager } from '../../www/js/core/PluginManager.js';

describe('PluginCostV2Component', () => {
  
  describe('initialization', () => {
    it('should render with default properties', async () => {
      const el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
      
      expect(el.activeView).to.equal('project');
      expect(el.viewMode).to.equal('cost');
      expect(el.loading).to.be.false;
      expect(el.error).to.be.null;
    });

    it('should default to current year date range', async () => {
      const el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
      const now = new Date();
      const year = now.getFullYear();
      
      expect(el.startDate).to.equal(`${year}-01-01`);
      expect(el.endDate).to.equal(`${year}-12-31`);
    });
  });

  describe('toolbar', () => {
    it('should render tab buttons', async () => {
      const el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
      el.setAttribute('visible', '');
      await el.updateComplete;
      
      const buttons = el.shadowRoot.querySelectorAll('.tab-buttons button');
      // The component now exposes a fourth "Team Members" tab
      expect(buttons).to.have.length(4);
      expect(buttons[0].textContent.trim()).to.include('Plan');
      expect(buttons[1].textContent.trim()).to.include('Task');
      expect(buttons[2].textContent.trim()).to.include('Team View');
      expect(buttons[3].textContent.trim()).to.include('Team Members');
    });

    it('should highlight active tab', async () => {
      const el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
      el.setAttribute('visible', '');
      el.activeView = 'task';
      await el.updateComplete;
      
      const buttons = el.shadowRoot.querySelectorAll('.tab-buttons button');
      expect(buttons[1].classList.contains('active')).to.be.true;
    });

    it('should render date range inputs', async () => {
      const el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
      el.setAttribute('visible', '');
      await el.updateComplete;
      
      const dateInputs = el.shadowRoot.querySelectorAll('input[type="date"]');
      expect(dateInputs).to.have.length(2);
    });

    it('should render view mode toggle', async () => {
      const el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
      el.setAttribute('visible', '');
      // view-toggle only appears for certain views; ensure we're in Team view
      el.activeView = 'team';
      await el.updateComplete;

      const toggleButtons = el.shadowRoot.querySelectorAll('.view-toggle button');
      expect(toggleButtons).to.have.length(2);
      expect(toggleButtons[0].textContent.trim()).to.include('Cost');
      expect(toggleButtons[1].textContent.trim()).to.include('Hours');
    });
  });

  describe('view switching', () => {
    it('should switch to Task view when tab clicked', async () => {
      const el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
      el.setAttribute('visible', '');
      await el.updateComplete;
      
      const taskButton = el.shadowRoot.querySelectorAll('.tab-buttons button')[1];
      taskButton.click();
      await el.updateComplete;
      
      expect(el.activeView).to.equal('task');
    });

    it('should switch to Team view when tab clicked', async () => {
      const el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
      el.setAttribute('visible', '');
      await el.updateComplete;
      
      const teamButton = el.shadowRoot.querySelectorAll('.tab-buttons button')[2];
      teamButton.click();
      await el.updateComplete;
      
      expect(el.activeView).to.equal('team');
    });
  });

  describe('view mode toggle', () => {
    it('should switch to hours mode when Hours button clicked', async () => {
      const el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
      el.setAttribute('visible', '');
      // Ensure view-toggle is visible by switching to Team view
      el.activeView = 'team';
      await el.updateComplete;

      const hoursButton = el.shadowRoot.querySelectorAll('.view-toggle button')[1];
      hoursButton.click();
      await el.updateComplete;

      expect(el.viewMode).to.equal('hours');
    });

    it('should highlight active view mode', async () => {
      const el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
      el.setAttribute('visible', '');
      // Ensure view-toggle is visible by switching to Team view
      el.activeView = 'team';
      el.viewMode = 'hours';
      await el.updateComplete;

      const buttons = el.shadowRoot.querySelectorAll('.view-toggle button');
      expect(buttons[1].classList.contains('active')).to.be.true;
    });
  });

  describe('empty states', () => {
    it('should show empty state when no data', async () => {
      const el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
      el.setAttribute('visible', '');
      el.data = null;
      await el.updateComplete;
      
      const emptyState = el.shadowRoot.querySelector('.empty-state');
      expect(emptyState).to.exist;
    });

    it('should show loading state when loading', async () => {
      const el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
      el.setAttribute('visible', '');
      el.loading = true;
      await el.updateComplete;
      
      const loadingState = el.shadowRoot.querySelector('.loading');
      expect(loadingState).to.exist;
      expect(loadingState.textContent).to.include('Loading');
    });

    it('should show error state when error occurs', async () => {
      const el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
      el.setAttribute('visible', '');
      el.error = 'Test error message';
      await el.updateComplete;
      
      const errorState = el.shadowRoot.querySelector('.error');
      expect(errorState).to.exist;
      expect(errorState.textContent).to.include('Test error message');
    });
  });

  describe('Project view', () => {
    it('should render project tables when data available', async () => {
      const el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
      el.setAttribute('visible', '');
      
      // Mock data
      el.data = {
        projects: {
          'proj-1': {
            id: 'proj-1',
            name: 'Test Project',
            features: []
          }
        }
      };
      el.activeView = 'project';
      await el.updateComplete;
      
      // Note: This test requires mocking state.projects for full functionality
      // Actual rendering tests should be done with proper test fixtures
    });
  });

  describe('Task view', () => {
    it('should show selection prompt when no projects selected', async () => {
      const el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
      el.setAttribute('visible', '');
      el.data = { projects: {} };
      el.activeView = 'task';
      await el.updateComplete;
      
      const emptyState = el.shadowRoot.querySelector('.empty-state');
      expect(emptyState).to.exist;
    });
  });

  describe('Team view', () => {
    it('should show team selection prompt when no teams selected', async () => {
      const el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
      el.setAttribute('visible', '');
      el.data = { projects: {} };
      el.activeView = 'team';
      await el.updateComplete;
      
      const emptyState = el.shadowRoot.querySelector('.empty-state');
      expect(emptyState).to.exist;
    });
  });

  describe('close functionality', () => {
    it('should hide when close is called', async () => {
      const el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
      el.setAttribute('visible', '');
      await el.updateComplete;
      // Ensure pluginManager.get returns a plugin stub with deactivate()
      const origGet = pluginManager.get;
      pluginManager.get = () => ({ deactivate: () => { el.removeAttribute('visible'); } });

      el._closeClicked();
      await el.updateComplete;
      expect(el.hasAttribute('visible')).to.be.false;

      pluginManager.get = origGet;
    });

    it('should close when close button clicked', async () => {
      const el = await fixture(html`<plugin-cost-v2></plugin-cost-v2>`);
      el.setAttribute('visible', '');
      await el.updateComplete;
      // stub pluginManager.get to avoid calling real plugin code
      const origGet = pluginManager.get;
      pluginManager.get = () => ({ deactivate: () => { el.removeAttribute('visible'); } });

      const closeButton = el.shadowRoot.querySelector('.close-btn');
      closeButton.click();
      await el.updateComplete;
      expect(el.hasAttribute('visible')).to.be.false;

      pluginManager.get = origGet;
    });
  });
});
