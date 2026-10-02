import { expect } from '@open-wc/testing';
import { loadPluginConfiguration } from '../../www/js/app.js';

const modulesConfig = {
  modules: [
    { id: 'plugin-alpha', name: 'Alpha', enabled: true },
    { id: 'plugin-beta', name: 'Beta', enabled: true },
    { id: 'plugin-gamma', name: 'Gamma', enabled: false },
  ],
};

describe('app plugin configuration bootstrap', () => {
  afterEach(() => {
    delete window.APP_PLUGIN_SCHEMAS;
  });

  it('merges runtime configuration and publishes schema data', async () => {
    const schemas = { 'plugin-alpha': { fields: [] } };
    const dataService = {
      getPluginsConfig: async () => ({
        ok: true,
        data: {
          schema_version: 2,
          plugins: [
            { id: 'plugin-beta', enabled: true, activateOnStartup: true },
            { id: 'plugin-alpha', enabled: false, activateOnStartup: false },
          ],
        },
      }),
      getPluginsSchemas: async () => ({ ok: true, data: schemas }),
    };

    const merged = await loadPluginConfiguration(dataService, modulesConfig);

    expect(merged.modules.map(({ id }) => id)).to.deep.equal([
      'plugin-beta',
      'plugin-alpha',
      'plugin-gamma',
    ]);
    expect(merged.modules.map(({ enabled }) => enabled)).to.deep.equal([
      true,
      false,
      false,
    ]);
    expect(window.APP_PLUGIN_SCHEMAS).to.equal(schemas);
  });

  it('fails on runtime config Result failure without falling back to static modules', async () => {
    const dataService = {
      getPluginsConfig: async () => ({
        ok: false,
        error: { message: 'runtime config unavailable' },
      }),
      getPluginsSchemas: async () => {
        throw new Error('schemas should not load');
      },
    };

    const rejection = loadPluginConfiguration(dataService, modulesConfig).then(
      () => null,
      (error) => error
    );
    const error = await rejection;
    expect(error.message).to.equal('runtime config unavailable');
  });

  it('fails on plugin schema Result failure', async () => {
    const dataService = {
      getPluginsConfig: async () => ({
        ok: true,
        data: { schema_version: 2, plugins: [] },
      }),
      getPluginsSchemas: async () => ({
        ok: false,
        error: { message: 'plugin schemas unavailable' },
      }),
    };

    const rejection = loadPluginConfiguration(dataService, modulesConfig).then(
      () => null,
      (error) => error
    );
    const error = await rejection;
    expect(error.message).to.equal('plugin schemas unavailable');
  });
});