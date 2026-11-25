import { afterEach, expect, it, vi } from 'vitest';
import { adminProvider } from '../../www/admin/js/services/providerREST.js';
import '../../www/admin/js/components/admin/LocalPlans.lit.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('creates a revisioned local plan without ADO area settings', async () => {
  const methods = {
    getLocalPlans: { revision: 3, plans: [] },
    getLocalCatalogue: { processes: [{ name: 'Local', types: [
      { id: 'feature', name: 'Feature', backlog_level: 'portfolio' },
    ] }] },
    getIterations: { iteration_sets: [] },
    getProjects: { container_types: ['project'] },
    getWorkforce: { content: { teams: { schema_version: 3, teams: [], groups: [] } } },
  };
  for (const [method, data] of Object.entries(methods)) {
    vi.spyOn(adminProvider, method).mockResolvedValue({ ok: true, data });
  }
  const save = vi.spyOn(adminProvider, 'saveLocalPlans').mockImplementation(async (data) => ({
    ok: true, data: { ...data, revision: 4 },
  }));
  const element = document.createElement('admin-local-plans');
  document.body.append(element);
  await vi.waitFor(() => expect(element.shadowRoot.querySelector('[data-add-plan]')).not.toBeNull());
  element.shadowRoot.querySelector('[data-add-plan]').click();
  await element.updateComplete;
  const name = element.shadowRoot.querySelector('[name="plan-name"]');
  name.value = 'Delivery';
  name.dispatchEvent(new Event('input'));
  element.shadowRoot.querySelector('[value="feature"]').click();
  element.shadowRoot.querySelector('[data-save]').click();
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  const { revision, plans } = save.mock.calls[0][0];
  expect(revision).toBe(3);
  expect(plans[0]).toMatchObject({ name: 'Delivery', task_types: ['feature'], markers: [] });
  expect(plans[0]).not.toHaveProperty('area_path');
});