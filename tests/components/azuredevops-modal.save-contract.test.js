import { describe, expect, it, vi } from 'vitest';
import { displayFixture } from '../helpers/workItemDisplay.js';

vi.mock('../../www/js/plugins/reconciliation/runtime.js', () => ({
  reconciliation: { snapshot: { status: 'ready' } },
}));

const mockCmd = vi.hoisted(() => ({
  feature: {
    revertFeature: vi.fn(),
  },
}));

const mockSel = vi.hoisted(() => ({
  scenario: { isActiveScenarioMutable: vi.fn(() => true) },
  group: {
    getBaselineGroupById: vi.fn(),
  },
}));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: mockCmd,
  sel: mockSel,
}));

import { PublishScenarioModal } from '../../www/js/components/PublishScenarioModal.lit.js';
import { reconciliation } from '../../www/js/plugins/reconciliation/runtime.js';
import { store } from '../../www/js/application/store.js';

describe('PublishScenarioModal feature seam', () => {
  it('does not revert or confirm publishing after edit access is lost', () => {
    const modal = new PublishScenarioModal();
    const published = vi.fn();
    modal.addEventListener('scenario-publish', published);
    mockSel.scenario.isActiveScenarioMutable.mockReturnValue(false);
    const previousCalls = mockCmd.feature.revertFeature.mock.calls.length;
    try {
      modal._onRevertFeature('locked');
      modal._onSave();
      expect(mockCmd.feature.revertFeature.mock.calls.length).toBe(previousCalls);
      expect(published).not.toHaveBeenCalled();
    } finally { mockSel.scenario.isActiveScenarioMutable.mockReturnValue(true); }
  });

  it('registers the backend-neutral publication component', () => {
    expect(customElements.get('publish-scenario-modal')).toBe(PublishScenarioModal);
  });

  it('reverts through cmd.feature and clears selected feature cells', () => {
    const modal = new PublishScenarioModal();
    modal.requestUpdate = vi.fn();
    modal._selected = new Set(['f-1:start', 'f-1:end', 'f-2:state']);

    modal._onRevertFeature('f-1');

    expect(mockCmd.feature.revertFeature).toHaveBeenCalledWith('f-1');
    expect(modal._selected.has('f-1:start')).toBe(false);
    expect(modal._selected.has('f-1:end')).toBe(false);
    expect(modal._selected.has('f-2:state')).toBe(true);
    expect(modal.requestUpdate).toHaveBeenCalled();
  });

  it('resolves deleted group names from baseline metadata', () => {
    mockSel.group.getBaselineGroupById.mockReturnValue({ name: 'Operations' });
    const modal = new PublishScenarioModal();

    expect(modal._resolveGroupName('g-1', [])).toBe('Operations');
    expect(mockSel.group.getBaselineGroupById).toHaveBeenCalledWith('g-1');
  });

  it('summarizes scenario-only exceptions even without task edits', async () => {
    const modal = new PublishScenarioModal();
    modal.decisions = [{ id: 'finding:a', taskTitle: 'Task A', planName: 'Programme',
      findingTitle: 'Invalid dates', status: 'active', saveStatus: 'saved', reason: 'Agreed window' }];
    document.body.appendChild(modal);
    await modal.updateComplete;
    expect(modal.shadowRoot.textContent).toContain('Saved in this scenario');
    expect(modal.shadowRoot.textContent).toContain('Agreed window');
    expect(modal.shadowRoot.textContent).not.toContain('No changes to publish');
    modal.remove();
  });

  it('cancels through the helper contract rather than leaving it unresolved', () => {
    const modal = new PublishScenarioModal();
    const closed = vi.fn();
    modal.addEventListener('modal-close', closed);
    modal._onCancel();
    expect(closed).toHaveBeenCalledOnce();
  });

  it('hides reconciliation-only summaries when the plugin is disabled', async () => {
    const modal = new PublishScenarioModal();
    const source = [{ id: 'foreign', title: 'Foreign task', state: 'Active',
      process_id: 'process', project: 'other', type: 'Feature', parentId: null,
      start: '2026-10-01', end: '2026-10-10', capacity: [], relations: [] }];
    const projects = [{ id: 'other', name: 'Other plan', container_order: 0,
      work_item_display: displayFixture(undefined, { Active: 'InProgress', Done: 'Completed' }) }];
    modal.state = { baselineFeatures: source, teams: [], projects,
      getFeatureTitleById: (id) => id };
    modal.publicationContext = { source, referencePlanIds: [], projects,
      hierarchy: [{ types: ['Feature'] }], today: '2026-10-17' };
    modal.overrides = { foreign: { state: 'Done', note: 'Local draft' } };
    modal._selected = new Set(['foreign:state']);
    modal.decisions = [{ taskTitle: 'Foreign task', planName: 'Other plan',
      findingTitle: 'Invalid dates', status: 'active', saveStatus: 'saved', reason: 'Agreed' }];
    reconciliation.snapshot.status = 'inactive';
    document.body.appendChild(modal);
    try {
      await modal.updateComplete;
      expect(modal.shadowRoot.querySelector('[aria-label="Cross-plan impact"]')).toBeNull();
      expect(modal.shadowRoot.querySelector('[aria-label="Unresolved findings"]')).toBeNull();
      expect(modal.shadowRoot.querySelector('[aria-label="Scenario exception decisions"]')).toBeNull();
      expect(modal.shadowRoot.textContent).toContain('Local-only changes');
      expect(modal.shadowRoot.textContent).toContain('Task and group writes');
      reconciliation.snapshot.status = 'ready';
      modal.requestUpdate();
      await modal.updateComplete;
      expect(modal.shadowRoot.querySelector('[aria-label="Cross-plan impact"]')).not.toBeNull();
      expect(modal.shadowRoot.querySelector('[aria-label="Scenario exception decisions"]')).not.toBeNull();
    } finally {
      reconciliation.snapshot.status = 'ready';
      modal.remove();
    }
  });

  it('reviews retained overrides for unavailable tasks without publishing them', async () => {
    const modal = new PublishScenarioModal();
    const source = [{ id: 'available', title: 'Available task', state: 'Active',
      process_id: 'process', project: 'own', type: 'Feature', parentId: null,
      start: '2026-10-01', end: '2026-10-10', capacity: [], relations: [] }];
    const projects = [{ id: 'own', name: 'Own plan', container_order: 0,
      work_item_display: displayFixture(undefined, { Active: 'InProgress', Done: 'Completed' }) }];
    modal.state = { baselineFeatures: source, teams: [], projects,
      getFeatureTitleById: (id) => id };
    modal.publicationContext = { source, referencePlanIds: ['own'], projects,
      hierarchy: [{ types: ['Feature'] }],
      today: '2026-10-17' };
    modal.overrides = { available: { state: 'Done' }, '551519': { state: 'Done' } };
    const published = vi.fn();
    modal.addEventListener('scenario-publish', published);
    document.body.appendChild(modal);
    try {
      await modal.updateComplete;
      const unavailable = modal.shadowRoot.querySelector('[aria-label="Unavailable tasks"]');
      expect(unavailable.textContent).toContain('551519');
      const toggle = [...modal.shadowRoot.querySelectorAll('button')]
        .find((button) => button.textContent.includes('Toggle All'));
      toggle.click();
      await modal.updateComplete;
      expect([...modal._selected]).toEqual(['available:state']);
      modal._onSave();
      expect(published.mock.calls[0][0].detail.features).toEqual([
        { id: 'available', state: 'Done' },
      ]);
    } finally { modal.remove(); }
  });

  it('allows unavailable overrides to be explicitly reverted', async () => {
    const modal = new PublishScenarioModal();
    const previousState = store.getState();
    const scenario = { id: 'revert-test', overrides: { '551519': { state: 'Done' } } };
    store.setState({ ...previousState,
      scenarios: { ...previousState.scenarios, activeId: scenario.id, items: [scenario] } });
    mockCmd.feature.revertFeature.mockImplementationOnce((id) => {
      store.setState((state) => ({ ...state, scenarios: { ...state.scenarios,
        items: state.scenarios.items.map((item) => ({ ...item,
          overrides: Object.fromEntries(Object.entries(item.overrides)
            .filter(([taskId]) => taskId !== id)) })),
      } }));
      return true;
    });
    modal.state = { baselineFeatures: [], teams: [], projects: [] };
    modal.overrides = scenario.overrides;
    document.body.appendChild(modal);
    try {
      await modal.updateComplete;
      modal.shadowRoot.querySelector('[aria-label="Unavailable tasks"] button').click();
      await modal.updateComplete;
      expect(mockCmd.feature.revertFeature).toHaveBeenCalledWith('551519');
      expect(store.getState().scenarios.items[0].overrides).toEqual({});
      expect(modal.overrides).toEqual({});
      expect(modal.shadowRoot.querySelector('[aria-label="Unavailable tasks"]')).toBeNull();
      expect(modal.shadowRoot.textContent).toContain('No changes to publish');
      expect(scenario.overrides).toEqual({ '551519': { state: 'Done' } });
    } finally {
      modal.remove();
      store.setState(previousState);
    }
  });
});
