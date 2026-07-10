import { expect, vi, beforeEach, afterEach, describe, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import '../../www-admin/js/components/admin/Plugins.lit.js';

// Minimal modules.config.json fixture (includes one entry missing id to test validation)
const MODULES_META = {
  modules: [
    {
      id: 'plugin-alpha',
      name: 'Alpha',
      version: '1.0.0',
      description: 'Alpha plugin',
      enabled: true,
      activated: false,
      exclusive: true,
      mountPoint: 'feature-board',
      dependencies: [],
    },
    {
      id: 'plugin-beta',
      name: 'Beta',
      version: '2.0.0',
      description: 'Beta plugin',
      enabled: false,
      activated: false,
      exclusive: false,
      mountPoint: 'app',
      dependencies: [],
    },
    {
      // Missing id — legacy bad entry
      name: 'Cost Analysis',
      version: '1.0.0',
      description: 'Cost analysis plugin',
      enabled: false,
      activated: false,
      exclusive: true,
      mountPoint: 'app',
      dependencies: [],
    },
  ],
};

const PLUGINS_CONFIG = [
  { id: 'plugin-alpha', enabled: true, activated: false },
  { id: 'plugin-beta', enabled: false, activated: false },
];

function useDefaultHandlers() {
  server.use(
    http.get('/js/modules.config.json', () => HttpResponse.json(MODULES_META, { status: 200 })),
    http.get('/admin/v1/plugins-config', () =>
      HttpResponse.json({ content: PLUGINS_CONFIG }, { status: 200 })
    ),
    http.post('/admin/v1/plugins-config', async ({ request }) => {
      const body = await request.json();
      return HttpResponse.json({ ok: true }, { status: 200 });
    })
  );
}

/** Wait for Lit update cycle + any pending micro-tasks */
async function flush(comp) {
  await comp.updateComplete;
  await new Promise((r) => setTimeout(r, 20));
  await comp.updateComplete;
}

describe('admin-plugins', () => {
  let comp;

  beforeEach(() => {
    useDefaultHandlers();
    comp = document.createElement('admin-plugins');
    document.body.appendChild(comp);
  });

  afterEach(() => {
    if (comp) comp.remove();
    server.resetHandlers();
  });

  describe('component load and render', () => {
    it('renders a row for each plugin including the invalid one', async () => {
      await flush(comp);
      expect(comp._rows).to.have.length(3);
    });

    it('renders read-only metadata columns from modules.config.json', async () => {
      await flush(comp);
      const alpha = comp._rows.find((r) => r.id === 'plugin-alpha');
      expect(alpha).to.exist;
      expect(alpha.name).to.equal('Alpha');
      expect(alpha.version).to.equal('1.0.0');
      expect(alpha.mountPoint).to.equal('feature-board');
      expect(alpha.exclusive).to.equal(true);
    });

    it('merges enabled/activated from runtime config', async () => {
      await flush(comp);
      const alpha = comp._rows.find((r) => r.id === 'plugin-alpha');
      expect(alpha.enabled).to.equal(true);
      expect(alpha.activated).to.equal(false);
    });

    it('shows validation error for entry missing id', async () => {
      await flush(comp);
      expect(comp._validationErrors).to.have.length(1);
      expect(comp._validationErrors[0]).to.include('missing an id');
    });
  });

  describe('activated exclusivity', () => {
    it('activating a plugin deactivates all others', async () => {
      await flush(comp);
      // Manually enable both for this test
      comp._rows = comp._rows.map((r) => ({ ...r, enabled: !!r.id }));
      await comp.updateComplete;

      comp._onSelectActivated(0);
      await comp.updateComplete;
      expect(comp._rows[0].activated).to.equal(true);
      expect(comp._rows[1].activated).to.equal(false);

      comp._onSelectActivated(1);
      await comp.updateComplete;
      expect(comp._rows[0].activated).to.equal(false);
      expect(comp._rows[1].activated).to.equal(true);
    });

    it('activating again toggles off (deactivates)', async () => {
      await flush(comp);
      comp._rows = comp._rows.map((r, i) => ({ ...r, enabled: true, activated: i === 0 }));
      await comp.updateComplete;

      comp._onSelectActivated(0);
      await comp.updateComplete;
      expect(comp._rows[0].activated).to.equal(false);
    });
  });

  describe('disabling active plugin clears activation', () => {
    it('toggling enabled off when activated also clears activated', async () => {
      await flush(comp);
      // Set plugin-alpha as enabled + activated
      comp._rows = comp._rows.map((r) =>
        r.id === 'plugin-alpha' ? { ...r, enabled: true, activated: true } : r
      );
      await comp.updateComplete;

      const idx = comp._rows.findIndex((r) => r.id === 'plugin-alpha');
      comp._onToggleEnabled(idx);
      await comp.updateComplete;

      const row = comp._rows[idx];
      expect(row.enabled).to.equal(false);
      expect(row.activated).to.equal(false);
    });
  });

  describe('reorder — move up/down', () => {
    it('_onMoveUp swaps rows', async () => {
      await flush(comp);
      const firstId = comp._rows[0].id;
      const secondId = comp._rows[1].id;
      comp._onMoveUp(1);
      await comp.updateComplete;
      expect(comp._rows[0].id).to.equal(secondId);
      expect(comp._rows[1].id).to.equal(firstId);
    });

    it('_onMoveDown swaps rows', async () => {
      await flush(comp);
      const firstId = comp._rows[0].id;
      const secondId = comp._rows[1].id;
      comp._onMoveDown(0);
      await comp.updateComplete;
      expect(comp._rows[0].id).to.equal(secondId);
      expect(comp._rows[1].id).to.equal(firstId);
    });

    it('_onMoveUp does nothing for first row', async () => {
      await flush(comp);
      const firstId = comp._rows[0].id;
      comp._onMoveUp(0);
      await comp.updateComplete;
      expect(comp._rows[0].id).to.equal(firstId);
    });

    it('_onMoveDown does nothing for last row', async () => {
      await flush(comp);
      const lastIdx = comp._rows.length - 1;
      const lastId = comp._rows[lastIdx].id;
      comp._onMoveDown(lastIdx);
      await comp.updateComplete;
      expect(comp._rows[lastIdx].id).to.equal(lastId);
    });
  });

  describe('save payload and providerREST calls', () => {
    // Helpers to set up a clean (no-invalid-entry) component for save tests
    function useCleanHandlers(postHandler) {
      server.use(
        http.get('/js/modules.config.json', () =>
          HttpResponse.json(
            {
              modules: [
                { id: 'plugin-alpha', name: 'Alpha', version: '1.0.0', description: 'Alpha plugin', enabled: true, activated: false, exclusive: true, mountPoint: 'feature-board', dependencies: [] },
                { id: 'plugin-beta', name: 'Beta', version: '2.0.0', description: 'Beta plugin', enabled: false, activated: false, exclusive: false, mountPoint: 'app', dependencies: [] },
              ],
            },
            { status: 200 }
          )
        ),
        http.get('/admin/v1/plugins-config', () =>
          HttpResponse.json({ content: PLUGINS_CONFIG }, { status: 200 })
        ),
        postHandler
      );
    }

    it('save sends ordered list of valid-id rows to /admin/v1/plugins-config', async () => {
      let capturedBody = null;
      useCleanHandlers(
        http.post('/admin/v1/plugins-config', async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ ok: true }, { status: 200 });
        })
      );

      await comp._load();
      await comp.updateComplete;
      await comp._onSave();

      expect(capturedBody).to.exist;
      expect(capturedBody.content).to.be.an('array');
      // Only entries with valid ids
      capturedBody.content.forEach((item) => expect(item.id).to.be.a('string'));
      // Payload shape includes enabled and activated fields
      const alpha = capturedBody.content.find((x) => x.id === 'plugin-alpha');
      expect(alpha).to.exist;
      expect(alpha).to.have.property('enabled');
      expect(alpha).to.have.property('activated');
    });

    it('reorder persists expected sequence in save payload', async () => {
      let capturedBody = null;
      useCleanHandlers(
        http.post('/admin/v1/plugins-config', async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ ok: true }, { status: 200 });
        })
      );

      await comp._load();
      await comp.updateComplete;

      comp._onMoveDown(0);
      await comp.updateComplete;

      await comp._onSave();

      const ids = capturedBody.content.map((x) => x.id);
      expect(ids.indexOf('plugin-beta')).to.be.lessThan(ids.indexOf('plugin-alpha'));
    });

    it('blocks save when validation errors exist', async () => {
      await flush(comp);
      expect(comp._hasValidationErrors()).to.equal(true);

      const saveSpy = vi.spyOn(adminProvider, 'savePluginsConfig');
      await comp._onSave();
      expect(saveSpy).not.toHaveBeenCalled();
      saveSpy.mockRestore();
    });

    it('shows ok status after successful save', async () => {
      // Use metadata without the bad entry so save is unblocked
      server.use(
        http.get('/js/modules.config.json', () =>
          HttpResponse.json(
            {
              modules: [
                { id: 'plugin-alpha', name: 'Alpha', version: '1.0.0', description: '', enabled: true, activated: false, exclusive: true, mountPoint: 'feature-board', dependencies: [] },
              ],
            },
            { status: 200 }
          )
        ),
        http.post('/admin/v1/plugins-config', async () =>
          HttpResponse.json({ ok: true }, { status: 200 })
        )
      );

      await comp._load();
      await comp.updateComplete;

      await comp._onSave();
      await comp.updateComplete;

      expect(comp._statusType).to.equal('ok');
      expect(comp._statusMsg).to.include('Saved');
    });

    it('shows error status when save fails', async () => {
      server.use(
        http.get('/js/modules.config.json', () =>
          HttpResponse.json(
            {
              modules: [
                { id: 'plugin-alpha', name: 'Alpha', version: '1.0.0', description: '', enabled: true, activated: false, exclusive: true, mountPoint: 'feature-board', dependencies: [] },
              ],
            },
            { status: 200 }
          )
        ),
        http.post('/admin/v1/plugins-config', async () =>
          HttpResponse.json({ ok: false, error: 'server error' }, { status: 500 })
        )
      );

      await comp._load();
      await comp.updateComplete;

      await comp._onSave();
      await comp.updateComplete;

      expect(comp._statusType).to.equal('error');
    });
  });
});

// Standalone providerREST method tests
describe('adminProvider plugins-config methods', () => {
  let adminProvider;

  beforeEach(async () => {
    const mod = await import('../../www-admin/js/services/providerREST.js');
    adminProvider = mod.adminProvider;
  });

  afterEach(() => {
    server.resetHandlers();
  });

  it('getPluginsConfig returns content array on success', async () => {
    server.use(
      http.get('/admin/v1/plugins-config', () =>
        HttpResponse.json({ content: [{ id: 'plugin-alpha', enabled: true, activated: false }] }, { status: 200 })
      )
    );
    const result = await adminProvider.getPluginsConfig();
    expect(result).to.be.an('array');
    expect(result[0].id).to.equal('plugin-alpha');
  });

  it('getPluginsConfig returns null on network failure', async () => {
    server.use(
      http.get('/admin/v1/plugins-config', () => HttpResponse.json({}, { status: 500 }))
    );
    const result = await adminProvider.getPluginsConfig();
    expect(result).to.equal(null);
  });

  it('savePluginsConfig posts content and returns ok', async () => {
    let body = null;
    server.use(
      http.post('/admin/v1/plugins-config', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true }, { status: 200 });
      })
    );
    const result = await adminProvider.savePluginsConfig([{ id: 'plugin-alpha', enabled: true, activated: false }]);
    expect(result.ok).to.equal(true);
    expect(body.content[0].id).to.equal('plugin-alpha');
  });

  it('savePluginsConfig returns error object on HTTP error', async () => {
    server.use(
      http.post('/admin/v1/plugins-config', async () =>
        HttpResponse.json({ error: 'bad' }, { status: 400 })
      )
    );
    const result = await adminProvider.savePluginsConfig([]);
    expect(result.ok).to.equal(false);
    expect(result.error).to.include('400');
  });
});

// Import for the spy test
import { adminProvider } from '../../www-admin/js/services/providerREST.js';
