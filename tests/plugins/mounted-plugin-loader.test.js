import { describe, expect, it, vi } from 'vitest';
import { resolvePluginComponentLoader } from '../../www/js/plugins/MountedPlugin.js';

describe('resolvePluginComponentLoader', () => {
  it('returns matching loader for known component path', async () => {
    const loader = vi.fn(async () => ({ default: class FakeComponent {} }));
    const moduleMap = {
      './PluginHistoryComponent.js': loader,
    };

    const resolved = resolvePluginComponentLoader('./PluginHistoryComponent.js', moduleMap);

    expect(resolved).toBe(loader);
    await resolved();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('returns null when component path is not in the module map', () => {
    const resolved = resolvePluginComponentLoader('./MissingComponent.js', {});
    expect(resolved).toBe(null);
  });

  it('returns null when component path is empty', () => {
    expect(resolvePluginComponentLoader('')).toBe(null);
    expect(resolvePluginComponentLoader()).toBe(null);
  });
});
