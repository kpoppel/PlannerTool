import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bus } from '../../www/js/core/EventBus.js';
import { ViewManagementEvents } from '../../www/js/core/EventRegistry.js';

const mockSelectionCommands = vi.hoisted(() => ({
  setProjectSelected: vi.fn(),
  setProjectsSelectedBulk: vi.fn(),
}));
const mockFeatures = vi.hoisted(() => ({ current: [] }));
const mockView = vi.hoisted(() => ({ focusedPlanId: '' }));
const mockViewCommands = vi.hoisted(() => ({ setFocusedPlanId: vi.fn() }));

vi.mock('../../www/js/application/imports.js', () => ({
  cmd: {
    selection: mockSelectionCommands,
    view: mockViewCommands,
  },
  sel: {
    view: { getFocusedPlanId: () => mockView.focusedPlanId },
    selection: { getProjects: () => [] },
    scope: { getResolvedFeatures: () => mockFeatures.current },
    feature: {
      getAvailableTaskTypesOrdered: () => [],
      getCountsForProject: () => new Map(),
    },
  },
}));

import { PlanMenuLit } from '../../www/js/components/PlanMenu.lit.js';

describe('PlanMenu Phase 4 command seam', () => {
  beforeEach(() => {
    mockSelectionCommands.setProjectSelected.mockReset();
    mockSelectionCommands.setProjectsSelectedBulk.mockReset();
    mockFeatures.current = [];
    mockView.focusedPlanId = '';
    mockViewCommands.setFocusedPlanId.mockReset();
  });

  it('routes single toggle through cmd.selection.setProjectSelected', () => {
    const el = new PlanMenuLit();
    el.projects = [{ id: 'p1', selected: false }];

    el._toggleProject('p1');

    expect(mockSelectionCommands.setProjectSelected).toHaveBeenCalledWith('p1', true);
  });

  it('routes bulk toggle through cmd.selection.setProjectsSelectedBulk', () => {
    const el = new PlanMenuLit();
    el.projects = [
      { id: 'p1', selected: true },
      { id: 'p2', selected: false },
    ];

    el._handleProjectToggle();

    expect(mockSelectionCommands.setProjectsSelectedBulk).toHaveBeenCalledWith({
      p1: true,
      p2: true,
    });
  });

  it('keeps All/None scoped to shown plans and offers Clear hidden only when needed', async () => {
    mockFeatures.current = [{ id: 'task', project: 'p1' }];
    const el = new PlanMenuLit();
    document.body.appendChild(el);
    el.projects = [
      { id: 'p1', name: 'Shown', type: 'project', container_order: 0, selected: true },
      { id: 'p2', name: 'Hidden', type: 'project', container_order: 0, selected: true },
    ];
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('[title="Clear hidden plans"]')).toBeNull();

    el._chooseFocus(el.projects[0]);
    await el.updateComplete;
    const clearHidden = el.shadowRoot.querySelector('[title="Clear hidden plans"]');
    expect(clearHidden).not.toBeNull();
    expect(clearHidden.textContent.trim()).toBe('Clear hidden');
    el.shadowRoot.querySelector('.list-toggle-btn').click();
    expect(mockSelectionCommands.setProjectsSelectedBulk).toHaveBeenCalledWith({
      p1: false,
      p2: true,
    });

    clearHidden.click();
    expect(mockSelectionCommands.setProjectsSelectedBulk).toHaveBeenLastCalledWith({
      p1: true,
      p2: false,
    });
    el.projects = [
      { ...el.projects[0], selected: true },
      { ...el.projects[1], selected: false },
    ];
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('[title="Clear hidden plans"]')).toBeNull();

    el.projects = [
      { ...el.projects[0], selected: false },
      { ...el.projects[1], selected: true },
    ];
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('[title="Clear hidden plans"]')).not.toBeNull();
    el._chooseFocus(null);
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('[title="Clear hidden plans"]')).toBeNull();
    el.remove();
  });

  it('renders plans grouped in configured B, A, C container order', async () => {
    const el = new PlanMenuLit();
    document.body.appendChild(el);
    el.projects = [
      { id: 'a', name: 'Alpha', type: 'A', container_order: 1, selected: true },
      { id: 'c', name: 'Charlie', type: 'C', container_order: 2, selected: true },
      { id: 'b', name: 'Bravo', type: 'B', container_order: 0, selected: true },
    ];
    await el.updateComplete;

    const names = [...el.shadowRoot.querySelectorAll('.project-name-col')]
      .map((node) => node.textContent.trim());
    expect(names).to.deep.equal(['Bravo', 'Alpha', 'Charlie']);
    el.remove();
  });

  it('focuses on task-connected plans without changing their selection', async () => {
    mockFeatures.current = [
      { id: 'p1', project: 'program-1' },
      { id: 'a', project: 'project-a', parentId: 'p1' },
      { id: 'f1', project: 'team-f', parentId: 'a' },
      { id: 'p2', project: 'program-2' },
      { id: 'b', project: 'project-b', parentId: 'p2' },
      { id: 'f2', project: 'team-f', parentId: 'b' },
    ];
    const el = new PlanMenuLit();
    document.body.appendChild(el);
    el.projects = ['program-1', 'program-2', 'project-a', 'project-b', 'team-f']
      .map((id, index) => ({ id, name: id, type: index < 2 ? 'program' : 'project',
        container_order: index < 2 ? 0 : 1, selected: index === 1 }));
    await el.updateComplete;

    const focus = el.shadowRoot.querySelector('input[role="combobox"]');
    expect(focus).not.toBeNull();
    expect(el.shadowRoot.querySelector('select')).toBeNull();
    focus.value = 'program-1';
    focus.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect([...el.shadowRoot.querySelectorAll('[role="option"]')]
      .map((node) => node.textContent.trim())).toEqual(['All plans', 'program-1']);
    el.shadowRoot.querySelector('[role="option"][data-plan-id="program-1"]').click();
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('input[role="combobox"]').value).toBe('program-1');
    expect([...el.shadowRoot.querySelectorAll('.project-name-col')]
      .map((node) => node.textContent.trim())).toEqual(['program-1', 'project-a', 'team-f']);
    expect(mockSelectionCommands.setProjectsSelectedBulk).not.toHaveBeenCalled();
    el.shadowRoot.querySelector('input[role="combobox"]').click();
    await el.updateComplete;
    el.shadowRoot.querySelector('[role="option"][data-plan-id=""]').click();
    await el.updateComplete;
    expect(el.focusedPlanId).toBe('');
    expect(el.shadowRoot.querySelectorAll('.project-name-col')).toHaveLength(5);
    el.remove();
  });

  it('orders searchable plan choices by container level, then name', async () => {
    const el = new PlanMenuLit();
    document.body.appendChild(el);
    el.projects = [
      { id: 'team', name: 'Alpha team', type: 'team', container_order: 2 },
      { id: 'project-z', name: 'Zulu project', type: 'project', container_order: 1 },
      { id: 'program', name: 'Beta program', type: 'program', container_order: 0 },
      { id: 'project-a', name: 'Alpha project', type: 'project', container_order: 1 },
    ];
    await el.updateComplete;

    el.shadowRoot.querySelector('input[role="combobox"]').click();
    await el.updateComplete;
    expect([...el.shadowRoot.querySelectorAll('[role="option"]')]
      .map((node) => node.textContent.trim())).toEqual([
        'All plans', 'Beta program', 'Alpha project', 'Zulu project', 'Alpha team',
      ]);
    el.remove();
  });

  it('chooses the first matching plan with Enter and closes the list on blur', async () => {
    const el = new PlanMenuLit();
    document.body.appendChild(el);
    el.projects = [
      { id: 'program', name: 'Program', type: 'program', container_order: 0 },
      { id: 'team', name: 'Team', type: 'team', container_order: 1 },
    ];
    await el.updateComplete;

    const focus = el.shadowRoot.querySelector('input[role="combobox"]');
    focus.value = 'tea';
    focus.dispatchEvent(new Event('input'));
    await el.updateComplete;
    focus.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;
    expect(el.focusedPlanId).toBe('team');
    expect(focus.value).toBe('Team');

    focus.click();
    await el.updateComplete;
    focus.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('[role="listbox"]')).toBeNull();
    expect(el.focusedPlanId).toBe('team');
    el.remove();
  });

  it('persists chosen focus and restores the saved focus when a view is activated', async () => {
    const el = new PlanMenuLit();
    document.body.appendChild(el);
    el.projects = [
      { id: 'program', name: 'Program', type: 'program', container_order: 0 },
      { id: 'team', name: 'Team', type: 'team', container_order: 1 },
    ];
    await el.updateComplete;

    el._chooseFocus(el.projects[0]);
    expect(mockViewCommands.setFocusedPlanId).toHaveBeenCalledWith('program');
    mockView.focusedPlanId = 'team';
    bus.emit(ViewManagementEvents.ACTIVATED, { id: 'saved', data: {} });
    await el.updateComplete;

    expect(el.focusedPlanId).toBe('team');
    expect(el.shadowRoot.querySelector('input[role="combobox"]').value).toBe('Team');
    el.remove();
  });
});
