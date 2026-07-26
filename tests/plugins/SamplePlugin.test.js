import { expect, describe, it, beforeEach, vi, afterEach } from 'vitest';
import { SamplePlugin } from '../../www/js/plugins/SamplePlugin.js';
import { bus } from '../../www/js/core/EventBus.js';
import { FeatureEvents } from '../../www/js/core/EventRegistry.js';

describe('SamplePlugin', () => {
  let plugin;
  const testId = 'test-sample-plugin';

  beforeEach(() => {
    plugin = new SamplePlugin(testId, {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('schema and defaults', () => {
    it('provides admin config schema', async () => {
      const schema = await SamplePlugin.getAdminConfigSchema();
      expect(schema).to.exist;
      expect(schema.type).to.equal('object');
      expect(schema.properties).to.have.all.keys(
        'sampleSetting',
        'enableLogging',
        'threshold'
      );
    });

    it('provides default admin config', async () => {
      const defaults = await SamplePlugin.getDefaultAdminConfig();
      expect(defaults.sampleSetting).to.equal('Sample');
      expect(defaults.enableLogging).to.equal(false);
      expect(defaults.threshold).to.equal(50);
    });

    it('schema properties have correct types', async () => {
      const schema = await SamplePlugin.getAdminConfigSchema();
      expect(schema.properties.sampleSetting.type).to.equal('string');
      expect(schema.properties.enableLogging.type).to.equal('boolean');
      expect(schema.properties.threshold.type).to.equal('number');
    });
  });

  describe('custom config consumption', () => {
    it('stores custom_config from constructor', () => {
      const customConfig = {
        sampleSetting: 'TestPrefix',
        enableLogging: true,
        threshold: 75,
      };
      const p = new SamplePlugin(testId, { custom_config: customConfig });
      expect(p._customConfig).to.deep.equal(customConfig);
    });

    it('uses default values when custom_config is empty', () => {
      const p = new SamplePlugin(testId, {});
      expect(p._customConfig).to.deep.equal({});
    });

    it('_logMessage respects enableLogging config', () => {
      const consoleSpy = vi.spyOn(console, 'log');

      // Without logging enabled
      plugin._logMessage('test message', 'test');
      expect(consoleSpy).not.toHaveBeenCalled();

      // With logging enabled
      plugin._customConfig.enableLogging = true;
      plugin._customConfig.sampleSetting = 'TestPrefix';
      plugin._logMessage('test message', 'test');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('TestPrefix')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('test message')
      );

      consoleSpy.mockRestore();
    });

    it('_logMessage uses configured prefix', () => {
      const consoleSpy = vi.spyOn(console, 'log');

      plugin._customConfig.enableLogging = true;
      plugin._customConfig.sampleSetting = 'CustomPrefix';
      plugin._logMessage('test', 'test');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('CustomPrefix')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('lifecycle and event handling (MountedPlugin)', () => {
    it('provides correct metadata', () => {
      const meta = plugin.getMetadata();
      expect(meta.id).to.equal(testId);
      expect(meta.name).to.equal('Sample Plugin');
      expect(meta.section).to.equal('tools');
      expect(meta.autoActivate).to.be.false;
    });

    it('sets mountSelector to _body for floating panel', () => {
      expect(plugin.mountSelector).to.equal('_body');
    });

    it('returns correct component tag and path', () => {
      expect(plugin.componentTag).to.equal('sample-plugin-component');
      expect(plugin.componentPath).to.equal('./SamplePluginComponent.lit.js');
    });

    it('binds event handler reference in constructor', () => {
      // The bound reference should be a function (not the raw method)
      expect(plugin._boundOnFeatureSelect).to.be.a('function');
      // It should be a different reference than the original method
      expect(plugin._boundOnFeatureSelect).to.not.equal(plugin._onFeatureSelect);
    });

    it('lifecycle works with MountedPlugin when _host is mocked', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      plugin._customConfig.enableLogging = true;
      plugin._customConfig.sampleSetting = 'InitTest';

      // Mock the mount resolution so MountedPlugin can find a host element
      const appEl = document.createElement('div');
      appEl.id = 'app';
      document.body.appendChild(appEl);

      // Stub _resolveHost to return our mock, bypassing DOM query failures in JSDOM
      plugin._host = appEl;
      await plugin.init();

      expect(plugin.initialized).to.be.true;
      consoleSpy.mockRestore();
    });
  });
});
