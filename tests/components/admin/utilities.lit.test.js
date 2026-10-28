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

  it('excludes accounts and authentication through the rendered checkbox', async () => {
    comp.restoreData = {
      config: { test: true }, accounts: { users: {} },
      authentication: { account_auth: {}, auth_control: {} },
    };
    const restore = vi.spyOn(adminProvider, 'restoreBackup').mockResolvedValue({ ok: true, data: {} });
    await comp.updateComplete;
    comp.renderRoot.querySelector('#restore-accounts').click();
    await comp.updateComplete;
    expect(comp.renderRoot.querySelector('#accountRestoreWarning')).toBeNull();
    expect(comp.renderRoot.querySelector('#restore-authentication')).toBeNull();
    await comp.handleRestore();
    expect(restore).toHaveBeenCalledWith({ config: { test: true } });
    expect(globalThis.confirm.mock.calls[0][0]).not.toContain('older');
  });

  it('includes sanitized authentication and requires fresh operator-reset credentials', async () => {
    comp.restoreData = {
      accounts: { users: {} }, authentication: { account_auth: {}, auth_control: {} },
    };
    const restore = vi.spyOn(adminProvider, 'restoreBackup').mockResolvedValue({ ok: true, data: {} });
    await comp.updateComplete;
    const warning = comp.renderRoot.querySelector('#accountRestoreWarning').textContent;
    expect(warning).toContain('excludes credentials');
    expect(warning).toContain('Reset access');
    expect(warning).toContain('offline operator reset');
    await comp.handleRestore();
    expect(restore).toHaveBeenCalledWith(comp.restoreData);
    expect(globalThis.confirm.mock.calls[0][0]).toContain('Reset access');
    expect(comp.restoreStatus).toContain('Reset access');
  });

  it('does not restore after cancelling the account consequences confirmation', async () => {
    comp.restoreData = {
      accounts: { users: {} }, authentication: { account_auth: {}, auth_control: {} },
    };
    globalThis.confirm.mockReturnValue(false);
    const restore = vi.spyOn(adminProvider, 'restoreBackup');
    await comp.handleRestore();
    expect(restore).not.toHaveBeenCalled();
  });

  it('preserves schema revision when selectively restoring config', async () => {
    comp.restoreData = { schema_revision: 32, config: {}, accounts: { users: {} } };
    comp.restoreOptions = { config: true, accounts: false, views: false, scenarios: false };
    const restore = vi.spyOn(adminProvider, 'restoreBackup').mockResolvedValue({ ok: true, data: {} });
    await comp.handleRestore();
    expect(restore).toHaveBeenCalledWith({ schema_revision: 32, config: {} });
  });

  it('groups workforce transfer under Backup & Restore without the rates banner', async () => {
    await comp.updateComplete;
    const transfer = comp.renderRoot.querySelector('.workforce-transfer');
    const panel = transfer.closest('.panel');
    expect(panel).not.toBeNull();
    expect(panel.querySelector('h3').textContent).toBe('Backup & Restore');
    expect(transfer.querySelector('h4').textContent).toBe('Workforce');
    expect(comp.renderRoot.textContent).not.toContain(
      'Workforce exports include supplier rates. Keep these files private.',
    );
  });

  it('provides matching System and Workforce backup and restore file-picker buttons', async () => {
    await comp.updateComplete;
    const system = comp.renderRoot.querySelector('.system-transfer');
    const workforce = comp.renderRoot.querySelector('.workforce-transfer');
    expect(system.querySelector('h4').textContent).toBe('System');
    for (const section of [system, workforce]) {
      const buttons = [...section.querySelector('.transfer-actions').querySelectorAll('button')];
      expect(buttons.map(button => button.textContent.trim())).toEqual(['Backup', 'Restore']);
      const input = section.querySelector('input[type="file"]');
      expect(input.hidden).toBe(true);
      const openPicker = vi.spyOn(input, 'click');
      buttons[1].click();
      expect(openPicker).toHaveBeenCalledTimes(1);
    }
  });

  it('checks system backup compatibility before making restore options available', async () => {
    const data = { schema_revision: 38, config: {} };
    const validate = vi.spyOn(adminProvider, 'validateBackup').mockResolvedValue({
      ok: true, data: { ok: true, schema_revision: 38 },
    });
    await comp.handleFileSelect({ target: { files: [
      new File([JSON.stringify(data)], 'system.json', { type: 'application/json' }),
    ] } });
    expect(validate).toHaveBeenCalledWith(data);
    expect(comp.restoreData).toEqual(data);
    expect(comp.restoreStatus).toContain('compatible');
    expect(comp.restoreLoading).toBe(false);
  });

  it.each(['flat', 'wrapped'])('rejects incompatible system files with %s server errors', async (shape) => {
    comp.restoreData = { schema_revision: 38, config: {} };
    const explanation = { error: 'restore_rejected', message: 'Incompatible backup schema' };
    const detail = shape === 'flat' ? explanation : { detail: explanation };
    vi.spyOn(adminProvider, 'validateBackup').mockResolvedValue({ ok: false,
      error: { message: 'HTTP 400', detail } });
    await comp.handleFileSelect({ target: { files: [
      new File(['{"schema_revision":99,"config":{}}'], 'future.json'),
    ] } });
    await comp.updateComplete;
    expect(comp.restoreData).toBeNull();
    expect(comp.restoreType).toBe('error');
    expect(comp.restoreStatus).toContain('Incompatible backup schema');
    expect(comp.renderRoot.querySelector('#restore-config')).toBeNull();
  });

  it('shows the server rejection reason when the system restore itself fails', async () => {
    comp.restoreData = { schema_revision: 38, config: {} };
    vi.spyOn(adminProvider, 'restoreBackup').mockResolvedValue({ ok: false, error: {
      message: 'HTTP 400', detail: {
        error: 'restore_rejected', message: 'Incompatible backup schema; server requires revision 38',
      },
    } });
    await comp.handleRestore();
    expect(comp.restoreStatus).toContain('Incompatible backup schema; server requires revision 38');
    expect(comp.restoreStatus).not.toContain('HTTP 400');
  });

  function workforceReview(ready = true) {
    return {
      revision: 'destination-revision', review_revision: 'review-revision', ready,
      errors: ready ? [] : ['Choose a skip or overwrite decision for every conflicting record'],
      records: [{ id: 'team-one', kind: 'team', name: 'Imported team', status: 'conflict',
        structural: false, decision: ready ? 'overwrite' : null,
        current: { id: 'team-one', name: 'Current team', allocation_token: 'ONE' },
        incoming: { id: 'team-one', name: 'Imported team', allocation_token: 'ONE' } }],
      coverage: { historically_complete: false, retained_tasks: 1, scenarios: 0, views: 0 },
    };
  }

  it('exports only the server-provided workforce YAML with a separate download', async () => {
    const source = 'format: plannertool-workforce\nversion: 1\n';
    vi.spyOn(adminProvider, 'exportWorkforce').mockResolvedValue({ ok: true, data: {
      content: { source, filename: 'planner-workforce.yaml' },
    } });
    const backup = vi.spyOn(adminProvider, 'getBackup');
    await comp.handleWorkforceExport();
    expect(blobParts).toEqual([source]);
    expect(comp.workforceType).toBe('success');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
    expect(backup).not.toHaveBeenCalled();
  });

  it('loads workforce files independently and requires a reviewed conflict choice', async () => {
    const source = 'format: plannertool-workforce\nversion: 1\n';
    comp.restoreData = { config: { existing: true } };
    const preview = vi.spyOn(adminProvider, 'previewWorkforceImport')
      .mockResolvedValueOnce({ ok: true, data: { content: workforceReview(false) } })
      .mockResolvedValueOnce({ ok: true, data: { content: workforceReview() } });
    await comp.handleWorkforceFileSelect({ target: { files: [
      new File([source], 'workforce.yaml', { type: 'application/yaml' }),
    ] } });
    await comp.updateComplete;
    expect(preview).toHaveBeenCalledWith(source, {});
    expect(comp.renderRoot.querySelector('#workforce-import').disabled).toBe(true);
    const select = comp.renderRoot.querySelector('[data-workforce-decision="team-one"]');
    expect(select.value).toBe('');
    select.value = 'overwrite';
    select.dispatchEvent(new Event('change'));
    await comp.updateComplete;
    expect(comp.renderRoot.querySelector('#workforce-import').disabled).toBe(true);
    await comp.handleWorkforcePreview();
    await comp.updateComplete;
    expect(preview).toHaveBeenLastCalledWith(source, { 'team-one': 'overwrite' });
    expect(comp.renderRoot.querySelector('#workforce-import').disabled).toBe(false);
    expect(comp.restoreData).toEqual({ config: { existing: true } });
  });

  it('confirms before import and submits only the reviewed file, choices and receipts', async () => {
    comp.workforceSource = 'format: plannertool-workforce';
    comp.workforceFilename = 'workforce.yaml';
    comp.workforceDecisions = { 'team-one': 'overwrite' };
    comp.workforceReview = workforceReview();
    comp.workforceReviewed = true;
    const commit = vi.spyOn(adminProvider, 'importWorkforce').mockResolvedValue({ ok: true, data: {
      content: { revision: 'committed' }, warnings: [{ message: 'Saved, but refresh failed' }],
    } });
    globalThis.confirm.mockReturnValueOnce(false);
    await comp.handleWorkforceImport();
    expect(commit).not.toHaveBeenCalled();
    await comp.handleWorkforceImport();
    expect(commit).toHaveBeenCalledWith({ source: 'format: plannertool-workforce',
      decisions: { 'team-one': 'overwrite' }, revision: 'destination-revision',
      review_revision: 'review-revision' });
    expect(comp.workforceType).toBe('warning');
    expect(comp.workforceStatus).toContain('Saved, but refresh failed');
    expect(comp.workforceReview).toBeNull();
  });

  it('requires a new preview after a stale or failed import', async () => {
    comp.workforceSource = 'format: plannertool-workforce';
    comp.workforceReview = workforceReview();
    comp.workforceReviewed = true;
    const commit = vi.spyOn(adminProvider, 'importWorkforce').mockResolvedValue({ ok: false,
      error: { message: 'Import review changed; preview again' } });
    await comp.handleWorkforceImport();
    expect(comp.workforceReviewed).toBe(false);
    expect(comp.workforceStatus).toContain('preview again');
    await comp.handleWorkforceImport();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('cancels the workforce preview without touching full restore data', async () => {
    comp.workforceSource = 'file';
    comp.workforceReview = workforceReview();
    comp.restoreData = { config: {} };
    await comp.updateComplete;
    comp.handleWorkforceCancel();
    expect(comp.workforceSource).toBe('');
    expect(comp.workforceReview).toBeNull();
    expect(comp.restoreData).toEqual({ config: {} });
  });

  it('rejects oversize files before calling the server', async () => {
    const preview = vi.spyOn(adminProvider, 'previewWorkforceImport');
    await comp.handleWorkforceFileSelect({ target: { files: [
      { name: 'large.yaml', size: 2 * 1024 * 1024 + 1 },
    ] } });
    expect(preview).not.toHaveBeenCalled();
    expect(comp.workforceType).toBe('error');
    expect(comp.workforceStatus).toContain('2 MiB');
  });

  it('allows new dependent records to be skipped and invalidates the confirmation', async () => {
    const review = workforceReview();
    review.records = [{ id: 'new-staffing', name: 'New staffing', kind: 'staffing', status: 'new',
      structural: false, decision: null, current: null, incoming: { id: 'new-staffing' } }];
    comp.workforceReview = review;
    comp.workforceSource = 'file';
    comp.workforceReviewed = true;
    await comp.updateComplete;
    const select = comp.renderRoot.querySelector('[data-workforce-decision="new-staffing"]');
    expect(select).not.toBeNull();
    expect(select.value).toBe('');
    select.value = 'skip';
    select.dispatchEvent(new Event('change'));
    await comp.updateComplete;
    expect(comp.workforceDecisions).toEqual({ 'new-staffing': 'skip' });
    expect(comp.renderRoot.querySelector('#workforce-import').disabled).toBe(true);
  });
});
