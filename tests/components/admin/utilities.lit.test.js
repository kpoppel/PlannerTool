import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../../../www/admin/js/components/admin/Utilities.lit.js';
import { adminProvider } from '../../../www/admin/js/services/providerREST.js';

describe('admin-utilities Result handling', () => {
  let comp;
  let originalBlob;
  let blobParts;
  let originalCreateObjectURL;
  let originalRevokeObjectURL;
  let originalConfirm;

  beforeEach(() => {
    comp = document.createElement('admin-utilities');
    document.body.appendChild(comp);

    originalBlob = globalThis.Blob;
    blobParts = null;
    globalThis.Blob = class FakeBlob {
      constructor(parts) {
        blobParts = parts;
      }
    };

    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();

    originalConfirm = globalThis.confirm;
    globalThis.confirm = vi.fn(() => true);
  });

  afterEach(() => {
    if (comp) comp.remove();
    globalThis.Blob = originalBlob;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    globalThis.confirm = originalConfirm;
    vi.restoreAllMocks();
  });

  it('handleBackup serializes result.data instead of whole Result envelope', async () => {
    vi.spyOn(adminProvider, 'getBackup').mockResolvedValue({
      ok: true,
      data: { config: { a: 1 }, scenarios: [{ id: 's1' }] },
    });

    await comp.handleBackup();

    expect(comp.backupType).toBe('success');
    expect(comp.backupStatus).toContain('Backup successful');
    expect(blobParts).toBeTruthy();
    expect(JSON.parse(blobParts[0])).toEqual({
      config: { a: 1 },
      scenarios: [{ id: 's1' }],
    });
  });

  it('handleBackup reports error.message on failure', async () => {
    vi.spyOn(adminProvider, 'getBackup').mockResolvedValue({
      ok: false,
      error: { message: 'backup endpoint unavailable' },
    });

    await comp.handleBackup();

    expect(comp.backupType).toBe('error');
    expect(comp.backupStatus).toContain('backup endpoint unavailable');
  });

  it('handleCacheCleanup reads orphaned count from result.data', async () => {
    vi.spyOn(adminProvider, 'cleanupCache').mockResolvedValue({
      ok: true,
      data: { orphaned_cleaned: 7 },
    });

    await comp.handleCacheCleanup();

    expect(comp.cleanupType).toBe('success');
    expect(comp.cleanupStatus).toContain('7 orphaned cache entries');
  });

  it('handleRestore uses warning from result.data.warning', async () => {
    comp.restoreData = {
      config: { test: true },
      accounts: { users: [] },
    };
    vi.spyOn(adminProvider, 'restoreBackup').mockResolvedValue({
      ok: true,
      data: { warning: 'restore completed with warnings' },
    });

    await comp.handleRestore();

    expect(comp.restoreType).toBe('warning');
    expect(comp.restoreStatus).toContain('restore completed with warnings');
  });
});
