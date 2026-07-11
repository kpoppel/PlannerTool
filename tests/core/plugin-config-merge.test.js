import { expect, describe, it } from 'vitest';
import { mergePluginConfig } from '../../www/js/core/pluginConfigMerge.js';

const META = {
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
      enabled: true,
      activated: false,
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
      activated: false,
      exclusive: true,
      mountPoint: 'app',
      dependencies: [],
    },
  ],
};

describe('mergePluginConfig', () => {
  it('returns modulesConfig unchanged when runtimeConfig is null', () => {
    const result = mergePluginConfig(META, null);
    expect(result).to.equal(META);
  });

  it('returns modulesConfig unchanged when runtimeConfig is empty array', () => {
    const result = mergePluginConfig(META, []);
    expect(result).to.equal(META);
  });

  it('applies runtime enabled/activated over metadata defaults', () => {
    const runtime = [
      { id: 'plugin-alpha', enabled: false, activated: false },
      { id: 'plugin-beta', enabled: true, activated: true },
    ];
    const result = mergePluginConfig(META, runtime);
    const alpha = result.modules.find((m) => m.id === 'plugin-alpha');
    const beta = result.modules.find((m) => m.id === 'plugin-beta');
    expect(alpha.enabled).to.equal(false);
    expect(beta.enabled).to.equal(true);
    expect(beta.activated).to.equal(true);
  });

  it('always uses technical fields from metadata regardless of runtime values', () => {
    const runtime = [
      { id: 'plugin-alpha', enabled: true, activated: false, name: 'HACKED', mountPoint: 'evil' },
    ];
    const result = mergePluginConfig(META, runtime);
    const alpha = result.modules.find((m) => m.id === 'plugin-alpha');
    expect(alpha.name).to.equal('Alpha');
    expect(alpha.mountPoint).to.equal('feature-board');
  });

  it('output follows runtime config order, then appends remaining metadata plugins', () => {
    // Runtime lists beta before alpha; gamma is not in runtime
    const runtime = [
      { id: 'plugin-beta', enabled: true, activated: false },
      { id: 'plugin-alpha', enabled: true, activated: false },
    ];
    const result = mergePluginConfig(META, runtime);
    const ids = result.modules.map((m) => m.id);
    expect(ids[0]).to.equal('plugin-beta');
    expect(ids[1]).to.equal('plugin-alpha');
    expect(ids[2]).to.equal('plugin-gamma'); // appended from metadata
  });

  it('plugins not in runtime config default activated to false regardless of metadata', () => {
    // gamma has activated:false in metadata, but even if metadata said true the default is false
    const runtime = [{ id: 'plugin-alpha', enabled: true, activated: false }];
    const result = mergePluginConfig(META, runtime);
    const gamma = result.modules.find((m) => m.id === 'plugin-gamma');
    expect(gamma.activated).to.equal(false);
  });

  it('plugins not in runtime config keep their metadata enabled value', () => {
    const runtime = [{ id: 'plugin-alpha', enabled: true, activated: false }];
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
      { id: 'plugin-unknown', enabled: true, activated: false },
      { id: 'plugin-alpha', enabled: true, activated: false },
    ];
    const result = mergePluginConfig(META, runtime);
    const ids = result.modules.map((m) => m.id);
    expect(ids).not.to.include('plugin-unknown');
    expect(ids).to.include('plugin-alpha');
  });

  it('passes through custom_config from runtime when present', () => {
    const runtime = [
      { id: 'plugin-alpha', enabled: true, activated: false, custom_config: { threshold: 5 } },
    ];
    const result = mergePluginConfig(META, runtime);
    const alpha = result.modules.find((m) => m.id === 'plugin-alpha');
    expect(alpha.custom_config).to.deep.equal({ threshold: 5 });
  });

  it('does not add custom_config key when runtime entry has none', () => {
    const runtime = [{ id: 'plugin-alpha', enabled: true, activated: false }];
    const result = mergePluginConfig(META, runtime);
    const alpha = result.modules.find((m) => m.id === 'plugin-alpha');
    expect(alpha).not.to.have.property('custom_config');
  });
});
