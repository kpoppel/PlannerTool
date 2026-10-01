import { expect, vi, beforeEach, afterEach, describe, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import '../../www/admin/js/components/admin/Plugins.lit.js';

// Minimal modules.config.json fixture (includes one entry missing id to test validation)
const MODULES_META = {
  modules: [
    {
      id: 'plugin-alpha',
      name: 'Alpha',
      version: '1.0.0',
      description: 'Alpha plugin',
      enabled: true,
      activateOnStartup: false,
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
      activateOnStartup: false,
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
      activateOnStartup: false,
      exclusive: true,
      mountPoint: 'app',
      dependencies: [],
    },
  ],
};

const PLUGINS_CONFIG = {
  schema_version: 2,
  plugins: [
    { id: 'plugin-alpha', enabled: true, activateOnStartup: false },
    { id: 'plugin-beta', enabled: false, activateOnStartup: false },
  ],
};

function useDefaultHandlers() {
  server.use(
    http.get('/static/js/modules.config.json', () => HttpResponse.json(MODULES_META, { status: 200 })),
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
    it('fetches metadata once and discovers schemas concurrently', async () => {
      await vi.waitFor(() => expect(comp._loading).to.equal(false));
      const metadataRequests = vi.fn(() => HttpResponse.json(MODULES_META));
      const schemaRequests = vi.fn();
      let releaseSchemas;
      const schemaGate = new Promise(resolve => { releaseSchemas = resolve; });
      server.use(
        http.get('/static/js/modules.config.json', metadataRequests),
        http.get('/static/js/plugins/:filename', async ({ params }) => {
          schemaRequests(params.filename);
          await schemaGate;
          return HttpResponse.json({ schema: { type: 'object' }, defaultConfig: {} });
        })
      );
      const loading = comp._load();
      try {
        await vi.waitFor(() => expect(schemaRequests).toHaveBeenCalledTimes(2));
      } finally {
        releaseSchemas();
        await loading;
      }
      expect(metadataRequests).toHaveBeenCalledTimes(1);
      expect(schemaRequests.mock.calls.map(([filename]) => filename).sort()).to.deep.equal([
        'PluginAlpha.schema.json', 'PluginBeta.schema.json',
      ]);
      expect(Object.keys(comp._schemas).sort()).to.deep.equal(['plugin-alpha', 'plugin-beta']);
    });

    it('blocks saving when runtime settings require migration', async () => {
      await flush(comp);
      server.use(http.get('/admin/v1/plugins-config', () => HttpResponse.json({
        error: 'invalid_payload', message: 'Run scripts/migrate.py --apply',
      }, { status: 400 })));
      await comp._load();
      await comp.updateComplete;
      expect(comp._rows).to.have.length(0);
      expect(comp._hasValidationErrors()).to.equal(true);
      expect(comp._statusType).to.equal('error');
      expect(comp.shadowRoot.querySelector('.btn-save').disabled).to.equal(true);
    });

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

    it('merges enabled/activateOnStartup from runtime config', async () => {
      await flush(comp);
      const alpha = comp._rows.find((r) => r.id === 'plugin-alpha');
      expect(alpha.enabled).to.equal(true);
      expect(alpha.activateOnStartup).to.equal(false);
    });

    it('shows validation error for entry missing id', async () => {
      await flush(comp);
      expect(comp._validationErrors).to.have.length(1);
      expect(comp._validationErrors[0]).to.include('missing an id');
    });
  });

  describe('activateOnStartup exclusivity', () => {
    it('activating a plugin deactivates all others', async () => {
      await flush(comp);
      // Manually enable both for this test
      comp._rows = comp._rows.map((r) => ({ ...r, enabled: !!r.id }));
      await comp.updateComplete;

      comp._onSelectActivated(0);
      await comp.updateComplete;
      expect(comp._rows[0].activateOnStartup).to.equal(true);
      expect(comp._rows[1].activateOnStartup).to.equal(false);

      comp._onSelectActivated(1);
      await comp.updateComplete;
      expect(comp._rows[0].activateOnStartup).to.equal(false);
      expect(comp._rows[1].activateOnStartup).to.equal(true);
    });

    it('activating again toggles off (deactivates)', async () => {
      await flush(comp);
      comp._rows = comp._rows.map((r, i) => ({ ...r, enabled: true, activateOnStartup: i === 0 }));
      await comp.updateComplete;

      comp._onSelectActivated(0);
      await comp.updateComplete;
      expect(comp._rows[0].activateOnStartup).to.equal(false);
    });
  });

  describe('disabling active plugin clears activation', () => {
    it('toggling enabled off when activateOnStartup also clears activateOnStartup', async () => {
      await flush(comp);
      // Set plugin-alpha as enabled + activateOnStartup
      comp._rows = comp._rows.map((r) =>
        r.id === 'plugin-alpha' ? { ...r, enabled: true, activateOnStartup: true } : r
      );
      await comp.updateComplete;

      const idx = comp._rows.findIndex((r) => r.id === 'plugin-alpha');
      comp._onToggleEnabled(idx);
      await comp.updateComplete;

      const row = comp._rows[idx];
      expect(row.enabled).to.equal(false);
      expect(row.activateOnStartup).to.equal(false);
    });
  });

  describe('reorder — move up/down', () => {
    it('edits menu position and prevents startup activation of menu plugins', async () => {
      await flush(comp);
      comp._rows = [{
        id: 'sample-menu-plugin', type: 'menu', name: 'Sample Menu', version: '1.0.0',
        description: 'Sample menu', enabled: true, activateOnStartup: false,
        menuPosition: 'before-tools', custom_config: {},
      }];
      await comp.updateComplete;
      const position = comp.shadowRoot.querySelector('select[aria-label="Sample Menu menu position"]');
      expect(position).to.exist;
      position.value = 'after-tools';
      position.dispatchEvent(new Event('change'));
      comp._onSelectActivated(0);
      await comp.updateComplete;
      expect(comp._rows[0].menuPosition).to.equal('after-tools');
      expect(comp._rows[0].activateOnStartup).to.equal(false);
      expect(comp.shadowRoot.querySelector('.radio-cell input')).to.equal(null);
      expect(comp._buildRow({ type: 'menu', menuPosition: 'before-tools' }, {
        enabled: true, activateOnStartup: true, menuPosition: 'after-tools',
      }).activateOnStartup).to.equal(false);
    });

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
    it('persists menu placement and reloads it with the same display sequence', async () => {
      await flush(comp);
      let saved;
      server.use(http.post('/admin/v1/plugins-config', async ({ request }) => {
        saved = (await request.json()).content;
        return HttpResponse.json({ ok: true });
      }));
      const metadata = [{
        id: 'sample-menu-plugin', type: 'menu', name: 'Sample Menu', version: '1.0.0',
        enabled: false, activateOnStartup: false, menuPosition: 'before-tools',
      }];
      comp._rows = comp._mergeConfig(metadata, { schema_version: 2, plugins: [] });
      comp._validationErrors = [];
      comp._onToggleEnabled(0);
      comp._onMenuPositionChange(0, 'after-tools');
      await comp._onSave();
      expect(saved.schema_version).to.equal(2);
      expect(saved.plugins).to.deep.equal([{
        id: 'sample-menu-plugin', enabled: true, activateOnStartup: false,
        menuPosition: 'after-tools', custom_config: {},
      }]);
      const reloaded = comp._mergeConfig(metadata, saved);
      expect(reloaded[0].menuPosition).to.equal('after-tools');
      expect(reloaded[0].enabled).to.equal(true);
    });

    // Helpers to set up a clean (no-invalid-entry) component for save tests
    function useCleanHandlers(postHandler) {
      server.use(
        http.get('/static/js/modules.config.json', () =>
          HttpResponse.json(
            {
              modules: [
                { id: 'plugin-alpha', name: 'Alpha', version: '1.0.0', description: 'Alpha plugin', enabled: true, activateOnStartup: false, exclusive: true, mountPoint: 'feature-board', dependencies: [] },
                { id: 'plugin-beta', name: 'Beta', version: '2.0.0', description: 'Beta plugin', enabled: false, activateOnStartup: false, exclusive: false, mountPoint: 'app', dependencies: [] },
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
      expect(capturedBody.content).to.be.an('object');
      expect(capturedBody.content.schema_version).to.equal(2);
      expect(capturedBody.content.plugins).to.be.an('array');
      // Only entries with valid ids
      capturedBody.content.plugins.forEach((item) => expect(item.id).to.be.a('string'));
      // Payload shape includes enabled and activateOnStartup fields
      const alpha = capturedBody.content.plugins.find((x) => x.id === 'plugin-alpha');
      expect(alpha).to.exist;
      expect(alpha).to.have.property('enabled');
      expect(alpha).to.have.property('activateOnStartup');
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

      const ids = capturedBody.content.plugins.map((x) => x.id);
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
        http.get('/static/js/modules.config.json', () =>
          HttpResponse.json(
            {
              modules: [
                { id: 'plugin-alpha', name: 'Alpha', version: '1.0.0', description: '', enabled: true, activateOnStartup: false, exclusive: true, mountPoint: 'feature-board', dependencies: [] },
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
        http.get('/static/js/modules.config.json', () =>
          HttpResponse.json(
            {
              modules: [
                { id: 'plugin-alpha', name: 'Alpha', version: '1.0.0', description: '', enabled: true, activateOnStartup: false, exclusive: true, mountPoint: 'feature-board', dependencies: [] },
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
      expect(comp._statusMsg).to.include('HTTP 500');
    });

    it('save includes custom_config in payload', async () => {
      let capturedBody = null;
      useCleanHandlers(
        http.post('/admin/v1/plugins-config', async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ ok: true }, { status: 200 });
        })
      );

      await comp._load();
      await comp.updateComplete;

      // Modify custom_config
      comp._rows[0].custom_config = { threshold: 75, enabled: true };
      await comp.updateComplete;

      await comp._onSave();

      expect(capturedBody.content.plugins[0]).to.have.property('custom_config');
      expect(capturedBody.content.plugins[0].custom_config).to.deep.equal({
        threshold: 75,
        enabled: true,
      });
    });

    it('_onCustomConfigChange updates custom_config for row', async () => {
      await comp._load();
      await comp.updateComplete;

      const newConfig = { setting: 'new value' };
      comp._onCustomConfigChange(0, newConfig);

      expect(comp._rows[0].custom_config).to.deep.equal(newConfig);
    });

    it('_validateCustomConfigs returns errors for missing required fields', async () => {
      await comp._load();
      await comp.updateComplete;

      // Mock schemas with a required field
      comp._schemas = {
        'plugin-alpha': {
          schema: {
            type: 'object',
            required: ['requiredField'],
          },
          defaultConfig: {},
        },
      };
      comp._rows[0].custom_config = {}; // missing requiredField

      const errors = comp._validateCustomConfigs();
      expect(errors.length).to.be.greaterThan(0);
      expect(errors[0]).to.include('missing required field');
    });
  });
});

// Standalone providerREST method tests
describe('adminProvider plugins-config methods', () => {
  let adminProvider;

  beforeEach(async () => {
    const mod = await import('../../www/admin/js/services/providerREST.js');
    adminProvider = mod.adminProvider;
  });

  afterEach(() => {
    server.resetHandlers();
  });

  it('getPluginsConfig returns content object on success', async () => {
    server.use(
      http.get('/admin/v1/plugins-config', () =>
        HttpResponse.json({ content: { schema_version: 1, plugins: [{ id: 'plugin-alpha', enabled: true, activateOnStartup: false }] } }, { status: 200 })
      )
    );
    const result = await adminProvider.getPluginsConfig();
    expect(result.ok).to.equal(true);
    expect(result.data).to.be.an('object');
    expect(result.data.schema_version).to.equal(1);
    expect(result.data.plugins).to.be.an('array');
    expect(result.data.plugins[0].id).to.equal('plugin-alpha');
  });

  it('getPluginsConfig returns Result failure on HTTP error', async () => {
    server.use(
      http.get('/admin/v1/plugins-config', () => HttpResponse.json({}, { status: 500 }))
    );
    const result = await adminProvider.getPluginsConfig();
    expect(result.ok).to.equal(false);
    expect(result.error).to.be.an('object');
    expect(result.error.message).to.include('HTTP 500');
  });

  it('savePluginsConfig posts content and returns ok', async () => {
    let body = null;
    server.use(
      http.post('/admin/v1/plugins-config', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true }, { status: 200 });
      })
    );
    const payload = { schema_version: 1, plugins: [{ id: 'plugin-alpha', enabled: true, activateOnStartup: false }] };
    const result = await adminProvider.savePluginsConfig(payload);
    expect(result.ok).to.equal(true);
    expect(body.content.schema_version).to.equal(1);
    expect(body.content.plugins[0].id).to.equal('plugin-alpha');
  });

  it('savePluginsConfig returns error object on HTTP error', async () => {
    server.use(
      http.post('/admin/v1/plugins-config', async () =>
        HttpResponse.json({ error: 'bad' }, { status: 400 })
      )
    );
    const result = await adminProvider.savePluginsConfig([]);
    expect(result.ok).to.equal(false);
    expect(result.error).to.be.an('object');
    expect(result.error.message).to.include('HTTP 400');
  });
});

// Import for the spy test
import { adminProvider } from '../../www/admin/js/services/providerREST.js';
