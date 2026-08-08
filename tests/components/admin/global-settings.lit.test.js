import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../../../www/admin/js/components/admin/GlobalSettings.lit.js';
import { adminProvider } from '../../../www/admin/js/services/providerREST.js';

describe('admin-global-settings Result handling', () => {
  let comp;

  beforeEach(() => {
    comp = document.createElement('admin-global-settings');
    document.body.appendChild(comp);
  });

  afterEach(() => {
    if (comp) comp.remove();
    vi.restoreAllMocks();
  });

  it('_load unwraps data from Result envelopes', async () => {
    vi.spyOn(adminProvider, 'getGlobalSettings').mockResolvedValue({
      ok: true,
      data: {
        task_type_hierarchy: [{ types: ['Epic'] }],
        state_display_sequence: [{ types: ['Done'] }],
      },
    });
    vi.spyOn(adminProvider, 'getSchema').mockResolvedValue({
      ok: true,
      data: {
        properties: {
          project_map: {
            items: {
              properties: {
                task_types: {
                  items: {
                    enum: ['Epic', 'Feature'],
                  },
                },
              },
            },
          },
        },
      },
    });
    vi.spyOn(adminProvider, 'getProjects').mockResolvedValue({
      ok: true,
      data: {
        project_map: [
          { display_states: ['New', 'Done'] },
          { display_states: ['Committed'] },
        ],
      },
    });

    await comp._load();

    expect(comp._hierarchy).toEqual([{ types: ['Epic'] }]);
    expect(comp._stateSequence).toEqual([{ types: ['Done'] }]);
    expect(comp._allTypes).toEqual(['Epic', 'Feature']);
    expect(comp._allStates).toEqual(['Committed', 'Done', 'New']);
  });

  it('_save renders error.message when save fails', async () => {
    vi.spyOn(adminProvider, 'saveGlobalSettings').mockResolvedValue({
      ok: false,
      error: { message: 'save denied' },
    });

    await comp._save();

    expect(comp._statusType).toBe('error');
    expect(comp._statusMsg).toContain('save denied');
  });
});
