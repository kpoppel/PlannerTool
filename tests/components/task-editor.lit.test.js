import { afterEach, expect, it, vi } from 'vitest';
import { dataService } from '../../www/js/services/dataService.js';
import '../../www/js/components/TaskEditor.lit.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('does not claim an initial state when the source owns workflow validation', async () => {
  vi.spyOn(dataService, 'getTaskEditor').mockResolvedValue({ ok: true, data: {
    plans: [{ id: 'plan', name: 'Plan', typeIds: ['feature'] }],
    catalogue: {
      processes: [{ id: 'process', types: [{ id: 'feature', name: 'Feature',
        workflow_id: 'flow', field_schema_id: 'schema' }] }],
      fields: [], field_schemas: [{ id: 'schema', fields: [] }],
      states: [{ id: 'open', name: 'Open' }],
      workflows: [{ id: 'flow', states: ['open'], initial: null, transitions: null, from_any: null }],
    },
  } });
  const editor = document.createElement('task-editor');
  document.body.append(editor);
  await vi.waitFor(() => expect(editor.shadowRoot.textContent).toContain('The task source sets the initial state.'));
  expect(editor.shadowRoot.textContent).not.toContain('Initial state: Open');
});

it('offers only allowed states and publishes typed changes with the reviewed baseline', async () => {
  const task = { id: 'one', project: 'plan', process_id: 'process', type: 'Feature', revision: 5,
    title: 'Original', description: null, state: 'Open', customFields: { score: 2 } };
  vi.spyOn(dataService, 'getTaskEditor').mockResolvedValue({ ok: true, data: { plans: [], catalogue: {
    processes: [{ id: 'process', types: [{ id: 'feature', name: 'Feature', workflow_id: 'flow',
      field_schema_id: 'schema' }] }], fields: [{ id: 'score-field', key: 'score', label: 'Score', type: 'integer' }],
    field_schemas: [{ id: 'schema', fields: [{ field_id: 'score-field', required: true,
      default: null, min: 0, max: 10, max_length: null }] }],
    states: [{ id: 'open', name: 'Open' }, { id: 'review', name: 'Review' }, { id: 'closed', name: 'Closed' }],
    workflows: [{ id: 'flow', states: ['open', 'review', 'closed'], initial: 'open',
      transitions: [{ from: 'open', to: 'review' }], from_any: [] }],
  } } });
  const publish = vi.spyOn(dataService, 'publishBaseline').mockResolvedValue({ ok: true, data: { errors: [] } });
  const editor = document.createElement('task-editor');
  editor.task = task;
  document.body.append(editor);
  await vi.waitFor(() => expect(editor.shadowRoot.querySelector('[name="state"]')).not.toBeNull());
  expect([...editor.shadowRoot.querySelectorAll('[name="state"] option')].map((option) => option.value))
    .toEqual(['Open', 'Review']);
  const score = editor.shadowRoot.querySelector('[name="score"]');
  score.value = '4';
  score.dispatchEvent(new Event('input'));
  editor.shadowRoot.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(publish).toHaveBeenCalledWith([{ id: 'one', customFields: { score: 4 },
    base: { revision: 5, fields: { customFields: { score: 2 } } } }]));
});

it('offers deletion only when the task backend declares it', async () => {
  const task = { id: 'one', project: 'plan', process_id: 'process', type: 'Feature', revision: 1,
    title: 'Original', description: null, state: 'Open', customFields: {} };
  vi.spyOn(dataService, 'getTaskEditor').mockResolvedValue({ ok: true, data: { plans: [], catalogue: {
    processes: [{ id: 'process', types: [{ id: 'feature', name: 'Feature', workflow_id: 'flow',
      field_schema_id: 'schema' }] }], fields: [], field_schemas: [{ id: 'schema', fields: [] }],
    states: [{ id: 'open', name: 'Open' }],
    workflows: [{ id: 'flow', states: ['open'], initial: 'open', transitions: [], from_any: [] }],
  } } });
  const buttons = async (canDelete) => {
    const editor = document.createElement('task-editor');
    Object.assign(editor, { task, canDelete });
    document.body.append(editor);
    await vi.waitFor(() => expect(editor.shadowRoot.querySelector('form')).not.toBeNull());
    return [...editor.shadowRoot.querySelectorAll('footer button')].map((button) => button.textContent.trim());
  };
  expect(await buttons(false)).toEqual(['Save task']);
  expect(await buttons(true)).toEqual(['Save task', 'Delete task']);
});