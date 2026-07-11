import { expect, describe, it, beforeEach, vi, afterEach } from 'vitest';
import { SamplePlugin } from '../../www/js/plugins/SamplePlugin.js';
import { bus } from '../../www/js/core/EventBus.js';
import { FeatureEvents } from '../../www/js/core/EventRegistry.js';

describe('SamplePlugin', () => {
  let plugin;
  const testId = 'test-sample-plugin';
  let mockElement;

  beforeEach(() => {
    plugin = new SamplePlugin(testId, {});
    // Create a mock element that looks like a real DOM node
    mockElement = {
      open: vi.fn(),
      close: vi.fn(),
      remove: vi.fn(),
      customConfig: {},
    };
    vi.spyOn(document, 'createElement').mockReturnValue(mockElement);
    vi.spyOn(document.body, 'appendChild').mockReturnValue(mockElement);
  });

  afterEach(() => {
    vi.clearAllMocks();
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
      // _logMessage should use defaults when config is empty
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

  describe('lifecycle and event handling', () => {
    it('initializes with logging when enabled in config', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      plugin._customConfig.enableLogging = true;
      plugin._customConfig.sampleSetting = 'InitTest';

      await plugin.init();

      expect(plugin.initialized).to.equal(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('InitTest')
      );

      consoleSpy.mockRestore();
    });

    it('activates and subscribes to feature select event', async () => {
      const eventSpy = vi.spyOn(bus, 'on');
      await plugin.activate();

      expect(plugin.active).to.equal(true);
      expect(eventSpy).toHaveBeenCalledWith(
        FeatureEvents.SELECTED,
        expect.any(Function)
      );

      eventSpy.mockRestore();
    });

    it('deactivates and unsubscribes from events', async () => {
      const eventSpy = vi.spyOn(bus, 'off');
      await plugin.activate();
      await plugin.deactivate();

      expect(plugin.active).to.equal(false);
      expect(eventSpy).toHaveBeenCalledWith(
        FeatureEvents.SELECTED,
        expect.any(Function)
      );

      eventSpy.mockRestore();
    });

    it('feature select event logs with threshold from custom_config', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      plugin._customConfig.enableLogging = true;
      plugin._customConfig.threshold = 85;

      plugin._onFeatureSelect({ featureId: 'feat-123' });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('threshold: 85')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('default behavior', () => {
    it('does not log when enableLogging is false (default)', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      await plugin.init();
      await plugin.activate();

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('handles feature select with default threshold when not configured', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      plugin._customConfig.enableLogging = true;
      // threshold not set, should use default 50

      plugin._onFeatureSelect({ featureId: 'feat-123' });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('threshold: 50')
      );

      consoleSpy.mockRestore();
    });

    it('destroys and clears initialized state', async () => {
      const eventSpy = vi.spyOn(bus, 'off');

      await plugin.init();
      await plugin.activate();
      await plugin.destroy();

      expect(plugin.initialized).to.equal(false);
      expect(eventSpy).toHaveBeenCalledWith(
        FeatureEvents.SELECTED,
        expect.any(Function)
      );

      eventSpy.mockRestore();
    });
  });
});
