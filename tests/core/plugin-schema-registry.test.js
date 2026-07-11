import { expect, describe, it, beforeEach } from 'vitest';
import {
  discoverPluginSchemas,
  getPluginSchema,
  hasPluginSchema,
} from '../../www/js/core/pluginSchemaRegistry.js';

describe('pluginSchemaRegistry', () => {
  let mockPluginManager;

  // Mock plugin class with schema
  class PluginWithSchema {
    constructor(id) {
      this.id = id;
    }

    static getAdminConfigSchema() {
      return {
        type: 'object',
        properties: {
          threshold: { type: 'number', default: 50 },
          enabled: { type: 'boolean', default: true },
        },
      };
    }

    static getDefaultAdminConfig() {
      return { threshold: 50, enabled: true };
    }
  }

  // Mock plugin class without schema
  class PluginWithoutSchema {
    constructor(id) {
      this.id = id;
    }
  }

  beforeEach(() => {
    mockPluginManager = {
      plugins: new Map(),
    };
  });

  it('discovers schemas from plugins that provide them', async () => {
    const p1 = new PluginWithSchema('plugin-a');
    mockPluginManager.plugins.set('plugin-a', p1);

    const schemaMap = await discoverPluginSchemas(mockPluginManager);
    expect(schemaMap['plugin-a']).to.exist;
    expect(schemaMap['plugin-a'].schema).to.deep.include({
      type: 'object',
    });
    expect(schemaMap['plugin-a'].defaultConfig).to.deep.equal({
      threshold: 50,
      enabled: true,
    });
  });

  it('skips plugins without schema', async () => {
    const p1 = new PluginWithoutSchema('plugin-b');
    mockPluginManager.plugins.set('plugin-b', p1);

    const schemaMap = await discoverPluginSchemas(mockPluginManager);
    expect(schemaMap['plugin-b']).to.not.exist;
  });

  it('mixes plugins with and without schemas', async () => {
    const p1 = new PluginWithSchema('plugin-a');
    const p2 = new PluginWithoutSchema('plugin-b');
    mockPluginManager.plugins.set('plugin-a', p1);
    mockPluginManager.plugins.set('plugin-b', p2);

    const schemaMap = await discoverPluginSchemas(mockPluginManager);
    expect(schemaMap['plugin-a']).to.exist;
    expect(schemaMap['plugin-b']).to.not.exist;
  });

  it('getPluginSchema retrieves schema by id', async () => {
    const p1 = new PluginWithSchema('plugin-a');
    mockPluginManager.plugins.set('plugin-a', p1);

    const schemaMap = await discoverPluginSchemas(mockPluginManager);
    const result = getPluginSchema('plugin-a', schemaMap);
    expect(result).to.exist;
    expect(result.schema.type).to.equal('object');
  });

  it('getPluginSchema returns null for unknown plugin', async () => {
    const schemaMap = {};
    const result = getPluginSchema('unknown-plugin', schemaMap);
    expect(result).to.equal(null);
  });

  it('hasPluginSchema returns true for plugins with schema', async () => {
    const p1 = new PluginWithSchema('plugin-a');
    mockPluginManager.plugins.set('plugin-a', p1);

    const schemaMap = await discoverPluginSchemas(mockPluginManager);
    expect(hasPluginSchema('plugin-a', schemaMap)).to.equal(true);
  });

  it('hasPluginSchema returns false for plugins without schema', async () => {
    const schemaMap = {};
    expect(hasPluginSchema('unknown-plugin', schemaMap)).to.equal(false);
  });
});
