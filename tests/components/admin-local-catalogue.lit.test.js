import { afterEach, expect, it, vi } from 'vitest';
import { adminProvider } from '../../www/admin/js/services/providerREST.js';
import '../../www/admin/js/components/admin/LocalCatalogue.lit.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('saves an explicit workflow transition with the loaded revision', async () => {
  const model = { revision: 7, fields: [], field_schemas: [], processes: [], states: [
    { id: 'todo', name: 'To Do', category: 'Proposed' },
    { id: 'done', name: 'Done', category: 'Completed' },
  ], workflows: [{ id: 'workflow', name: 'Standard', states: ['todo', 'done'],
    initial: 'todo', transitions: [], from_any: [] }] };
  vi.spyOn(adminProvider, 'getLocalCatalogue').mockResolvedValue({ ok: true, data: model });
  const save = vi.spyOn(adminProvider, 'saveLocalCatalogue').mockImplementation(async (data) => ({
    ok: true, data: { ...data, revision: 8 },
  }));
  const element = document.createElement('admin-local-catalogue');
  document.body.append(element);
  await vi.waitFor(() => expect(element.shadowRoot.querySelector('[data-tab="workflows"]')).not.toBeNull());
  element.shadowRoot.querySelector('[data-tab="workflows"]').click();
  await element.updateComplete;
  element.shadowRoot.querySelector('[data-transition="todo:done"]').click();
  await element.updateComplete;
  element.shadowRoot.querySelector('[data-save]').click();
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].revision).toBe(7);
  expect(save.mock.calls[0][0].workflows[0].transitions).toEqual([{ from: 'todo', to: 'done' }]);
});