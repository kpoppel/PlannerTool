import { describe, expect, it, vi } from 'vitest';

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
});
