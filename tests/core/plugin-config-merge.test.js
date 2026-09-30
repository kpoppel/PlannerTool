import { expect, describe, it, vi } from 'vitest';
import { mergePluginConfig } from '../../www/js/core/pluginConfigMerge.js';
import PluginRegistry from '../../www/js/core/pluginRegistry.js';
import modulesConfig from '../../www/js/modules.config.json';

const META = {
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
      enabled: true,
      activateOnStartup: false,
      exclusive: false,
      mountPoint: 'app',
      dependencies: [],
    },
    {
      id: 'plugin-gamma',
      name: 'Gamma',
      version: '1.0.0',
      description: 'Gamma plugin',
      enabled: false,
      activateOnStartup: false,
      exclusive: true,
      mountPoint: 'app',
      dependencies: [],
    },
  ],
};

describe('mergePluginConfig', () => {
  it('exposes consistent registration metadata for every plugin', () => {
    for (const config of modulesConfig.modules) {
      const plugin = new PluginRegistry[config.id](config.id, config);
      const metadata = plugin.getMetadata();
      expect(metadata.type).to.equal(config.type);
      expect(metadata.name).to.equal(config.name);
      expect(metadata.icon).to.equal(config.icon);
      expect(metadata.version).to.equal(config.version);
      expect(metadata).not.to.have.property('autoActivate');
      expect(metadata).not.to.have.property('showInTools');
      expect(metadata).not.to.have.property('section');
    }
  });

  it('creates a menu demonstration without activating a plugin', async () => {
    const config = modulesConfig.modules.find((entry) => entry.id === 'sample-menu-plugin');
    const plugin = new PluginRegistry[config.id](config.id, {
      ...config, custom_config: { initialCount: 3 },
    });
    await plugin.init();
    const element = plugin.createMenuElement();
    document.body.appendChild(element);
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('output').textContent).to.equal('3');
    element.shadowRoot.querySelector('button').click();
    await element.updateComplete;
    expect(plugin.counter).to.equal(4);
    expect(plugin.active).to.equal(false);
    element.remove();
  });

  it('preserves plugin type and metadata while applying admin menu position', () => {
    const modulesConfig = {
      modules: [{
        ...META.modules[0],
        type: 'menu',
        icon: 'help',
        menuPosition: 'before-tools',
      }],
    };
    const runtime = [{
      id: 'plugin-alpha',
      enabled: true,
      activateOnStartup: false,
      type: 'tool',
      menuPosition: 'after-tools',
    }];
    const result = mergePluginConfig(modulesConfig, runtime);
    expect(result.modules[0].type).to.equal('menu');
    expect(result.modules[0].icon).to.equal('help');
    expect(result.modules[0].menuPosition).to.equal('after-tools');
    expect(result.modules[0].version).to.equal('1.0.0');
  });

  it('returns modulesConfig unchanged when runtimeConfig is null', () => {
    const result = mergePluginConfig(META, null);
    expect(result).to.equal(META);
  });

  it('returns modulesConfig unchanged when runtimeConfig is empty array', () => {
    const result = mergePluginConfig(META, []);
    expect(result).to.equal(META);
  });

  it('applies runtime enabled/activateOnStartup over metadata defaults', () => {
    const runtime = [
      { id: 'plugin-alpha', enabled: false, activateOnStartup: false },
      { id: 'plugin-beta', enabled: true, activateOnStartup: true },
    ];
    const result = mergePluginConfig(META, runtime);
    const alpha = result.modules.find((m) => m.id === 'plugin-alpha');
    const beta = result.modules.find((m) => m.id === 'plugin-beta');
    expect(alpha.enabled).to.equal(false);
    expect(beta.enabled).to.equal(true);
    expect(beta.activateOnStartup).to.equal(true);
  });

  it('always uses technical fields from metadata regardless of runtime values', () => {
    const runtime = [
      { id: 'plugin-alpha', enabled: true, activateOnStartup: false, name: 'HACKED', mountPoint: 'evil' },
    ];
    const result = mergePluginConfig(META, runtime);
    const alpha = result.modules.find((m) => m.id === 'plugin-alpha');
    expect(alpha.name).to.equal('Alpha');
    expect(alpha.mountPoint).to.equal('feature-board');
  });

  it('preserves persistent as technical metadata when runtime config exists', () => {
    const meta = {
      modules: [
        {
          id: 'plugin-dependencies',
          name: 'Dependencies',
          version: '1.0.0',
          description: 'Render dependency arrows between feature cards',
          enabled: true,
          activateOnStartup: false,
          exclusive: false,
          persistent: true,
          mountPoint: 'feature-board',
          dependencies: [],
        },
      ],
    };
    const runtime = [
      {
        id: 'plugin-dependencies',
        enabled: true,
        activateOnStartup: false,
      },
    ];

    const result = mergePluginConfig(meta, runtime);

    expect(result.modules[0].persistent).to.equal(true);
  });

  it('output follows runtime config order, then appends remaining metadata plugins', () => {
    // Runtime lists beta before alpha; gamma is not in runtime
    const runtime = [
      { id: 'plugin-beta', enabled: true, activateOnStartup: false },
      { id: 'plugin-alpha', enabled: true, activateOnStartup: false },
    ];
    const result = mergePluginConfig(META, runtime);
    const ids = result.modules.map((m) => m.id);
    expect(ids[0]).to.equal('plugin-beta');
    expect(ids[1]).to.equal('plugin-alpha');
    expect(ids[2]).to.equal('plugin-gamma'); // appended from metadata
  });

  it('plugins not in runtime config default activateOnStartup to false regardless of metadata', () => {
    // gamma has activateOnStartup:false in metadata, but even if metadata said true the default is false
    const runtime = [{ id: 'plugin-alpha', enabled: true, activateOnStartup: false }];
    const result = mergePluginConfig(META, runtime);
    const gamma = result.modules.find((m) => m.id === 'plugin-gamma');
    expect(gamma.activateOnStartup).to.equal(false);
  });

  it('plugins not in runtime config keep their metadata enabled value', () => {
    const runtime = [{ id: 'plugin-alpha', enabled: true, activateOnStartup: false }];
    const result = mergePluginConfig(META, runtime);
    // beta not in runtime — should keep metadata enabled:true
    const beta = result.modules.find((m) => m.id === 'plugin-beta');
    expect(beta.enabled).to.equal(true);
    // gamma not in runtime — keeps metadata enabled:false
    const gamma = result.modules.find((m) => m.id === 'plugin-gamma');
    expect(gamma.enabled).to.equal(false);
  });

  it('runtime entries with unknown ids are skipped with a warning', () => {
    const runtime = [
      { id: 'plugin-unknown', enabled: true, activateOnStartup: false },
      { id: 'plugin-alpha', enabled: true, activateOnStartup: false },
    ];
    const result = mergePluginConfig(META, runtime);
    const ids = result.modules.map((m) => m.id);
    expect(ids).not.to.include('plugin-unknown');
    expect(ids).to.include('plugin-alpha');
  });

  it('suppresses warning for deprecated runtime ids that are intentionally retired', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = [
      { id: 'plugin-cost-v1', enabled: true, activateOnStartup: false },
      { id: 'plugin-alpha', enabled: true, activateOnStartup: false },
    ];

    const result = mergePluginConfig(META, runtime);
    const ids = result.modules.map((m) => m.id);

    expect(ids).not.to.include('plugin-cost-v1');
    expect(ids).to.include('plugin-alpha');
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('passes through custom_config from runtime when present', () => {
    const runtime = [
      { id: 'plugin-alpha', enabled: true, activateOnStartup: false, custom_config: { threshold: 5 } },
    ];
    const result = mergePluginConfig(META, runtime);
    const alpha = result.modules.find((m) => m.id === 'plugin-alpha');
    expect(alpha.custom_config).to.deep.equal({ threshold: 5 });
  });

  it('does not add custom_config key when runtime entry has none', () => {
    const runtime = [{ id: 'plugin-alpha', enabled: true, activateOnStartup: false }];
    const result = mergePluginConfig(META, runtime);
    const alpha = result.modules.find((m) => m.id === 'plugin-alpha');
    expect(alpha).not.to.have.property('custom_config');
  });
});
