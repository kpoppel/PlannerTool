import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdminProviderREST } from '../../www/admin/js/services/providerREST.js';

function mockResponse({ ok = true, status = 200, jsonData = null, jsonThrows = false } = {}) {
  return {
    ok,
    status,
    json: vi.fn(async () => {
      if (jsonThrows) throw new Error('json failure');
      return jsonData;
    }),
  };
}

function makeProvider() {
  const provider = new AdminProviderREST();
  provider._fetch = vi.fn();
  return provider;
}

const WORKFORCE_SNAPSHOT = {
  revision: 'fixture-revision',
  teams: { schema_version: 3, teams: [], groups: [] },
  workforce: { schema_version: 2, suppliers: [], staffing: [] },
};

const METHOD_ARGS = {
  reviewWorkforceTeamDeletion: ['team/one'],
  deleteWorkforceTeam: ['team/one', { revision: 'first', confirmation: {
    acknowledged: true, review_revision: 'review-one',
  } }],
  saveAreaMappings: [{ a: 1 }],
  saveProjects: [{ projects: [] }],
  saveSystem: [{ system: true }],
  saveAdo: [{ org: 'https://example' }],
  saveEventsConfig: [{ events: [] }],
  saveGroupsConfig: [{ groups: [] }],
  saveWorkforce: [WORKFORCE_SNAPSHOT],
  createWorkforceDefinition: ['profile', {
    revision: 'fixture-revision', supplier_id: 'supplier-one',
    fields: { name: 'Specialist', monthly_project_hours: 120, hourly_rate: 90 },
  }],
  createUser: ['new@example.com', []],
  setUserPermissions: ['11111111-1111-4111-8111-111111111111', ['admin']],
  deleteUser: ['11111111-1111-4111-8111-111111111111'],
  refreshAreaMapping: ['Area\\Path'],
  togglePlanEnabled: ['project-a', 'Area\\Path', 'plan-1', true],
  getSchema: ['iterations'],
  saveIterations: [{ default: [] }],
  browseIterations: [{ project: 'project-a' }],
  deleteIterationSet: ['set-1'],
  unassociateAllIterations: ['set-1'],
  browseAzureProjects: ['https://dev.azure.com/example'],
  browseAreaPaths: ['Project A'],
  browseWikis: ['Project A', 'https://dev.azure.com/example'],
  browseWikiPages: ['Project A', 'wiki-1', 'https://dev.azure.com/example'],
  getWorkItemMetadata: ['Project A'],
  getAreaPathMetadata: ['Project A', 'Area\\Path'],
  prefetchProjectsMetadata: [['Area\\One', 'Area\\Two']],
  restoreBackup: [{ snapshot: { version: 1 } }],
  saveGlobalSettings: [{ state_display_sequence: [] }],
  savePluginsConfig: [{ plugins: [] }],
};

const SUCCESS_JSON_METHODS = [
  'getAreaMappings',
  'saveAreaMappings',
  'getProjects',
  'saveProjects',
  'getSystem',
  'saveSystem',
  'getAdo',
  'saveAdo',
  'getEventsConfig',
  'saveEventsConfig',
  'getGroupsConfig',
  'saveGroupsConfig',
  'getWorkforce',
  'reviewWorkforceTeamDeletion',
  'deleteWorkforceTeam',
  'saveWorkforce',
  'createWorkforceDefinition',
  'getUsers',
  'createUser',
  'setUserPermissions',
  'deleteUser',
  'refreshAreaMapping',
  'refreshAllAreaMappings',
  'togglePlanEnabled',
  'getSchema',
  'getIterations',
  'saveIterations',
  'browseIterations',
  'unassociateAllIterations',
  'browseAzureProjects',
  'browseAreaPaths',
  'browseWikis',
  'browseWikiPages',
  'getWorkItemMetadata',
  'getAreaPathMetadata',
  'prefetchProjectsMetadata',
  'cleanupCache',
  'invalidateCache',
  'reloadConfig',
  'getBackup',
  'restoreBackup',
  'getGlobalSettings',
  'saveGlobalSettings',
  'getPluginsConfig',
  'savePluginsConfig',
];

describe('AdminProviderREST Result contract', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.APP_BASE_URL;
  });

  it('_fetch prefixes APP_BASE_URL for absolute paths', async () => {
    const provider = new AdminProviderREST();
    const response = { ok: true, status: 200 };
    fetchMock.mockResolvedValue(response);
    window.APP_BASE_URL = '/root';

    const out = await provider._fetch('/admin/v1/system', { method: 'GET' });

    expect(out).toBe(response);
    expect(fetchMock).toHaveBeenCalledWith(
      '/root/admin/v1/system',
      expect.objectContaining({ method: 'GET' })
    );
  });

  for (const method of SUCCESS_JSON_METHODS) {
    it(`${method} returns Result shape on success`, async () => {
      const args = METHOD_ARGS[method] || [];
      const provider = makeProvider();
      provider._fetch.mockResolvedValue(
        mockResponse({ ok: true, status: 200, jsonData: { content: { method }, method } })
      );

      const out = await provider[method](...args);
      expect(out).toBeTruthy();
      expect(out.ok).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(out, 'data')).toBe(true);
    });

    it(`${method} returns Result failure on thrown fetch`, async () => {
      const args = METHOD_ARGS[method] || [];
      const provider = makeProvider();
      provider._fetch.mockRejectedValue(new Error('boom'));

      const out = await provider[method](...args);
      expect(out.ok).toBe(false);
      expect(out.error).toBeTruthy();
      expect(typeof out.error).toBe('object');
      expect(typeof out.error.message).toBe('string');
      expect(out.error.message.length).toBeGreaterThan(0);
    });
  }

  it('account mutations put only anonymous IDs in resource URLs', async () => {
    const provider = makeProvider();
    provider._fetch.mockResolvedValue(mockResponse({ jsonData: { ok: true } }));
    const accountId = '11111111-1111-4111-8111-111111111111';

    await provider.setUserPermissions(accountId, ['admin']);
    await provider.deleteUser(accountId);

    expect(provider._fetch.mock.calls[0][0]).toBe(`/admin/v1/users/${accountId}/permissions`);
    expect(provider._fetch.mock.calls[1][0]).toBe(`/admin/v1/users/${accountId}`);
    expect(provider._fetch.mock.calls.flat().join(' ')).not.toContain('@');
  });

  it('deleteIterationSet keeps status/detail on non-OK HTTP and returns Result failure', async () => {
    const provider = makeProvider();
    provider._fetch.mockResolvedValue(
      mockResponse({ ok: false, status: 409, jsonData: { error: 'referenced_by_projects' } })
    );

    const out = await provider.deleteIterationSet('set-1');
    expect(out.ok).toBe(false);
    expect(out.error.status).toBe(409);
    expect(out.error.detail).toEqual({ error: 'referenced_by_projects' });
  });

  it('prefetchProjectsMetadata returns Result success without fetch for empty areaPaths', async () => {
    const provider = makeProvider();
    const out = await provider.prefetchProjectsMetadata([]);

    expect(out.ok).toBe(true);
    expect(out.data).toEqual({ results: {} });
    expect(provider._fetch).not.toHaveBeenCalled();
  });

  it('encodes deletion team IDs and preserves the review receipt and post-commit warnings', async () => {
    const provider = makeProvider();
    const review = { revision: 'first', review_revision: 'receipt', team: { id: 'team/one' } };
    const warnings = [{ error: 'cost_cache_invalidation_failed', message: 'Saved; refresh failed' }];
    const payload = { revision: 'first', confirmation: { acknowledged: true, review_revision: 'receipt' } };
    provider._fetch.mockResolvedValueOnce(mockResponse({ jsonData: { content: review } }))
      .mockResolvedValueOnce(mockResponse({ jsonData: { content: WORKFORCE_SNAPSHOT, warnings } }));
    expect((await provider.reviewWorkforceTeamDeletion('team/one')).data.content).toEqual(review);
    const committed = await provider.deleteWorkforceTeam('team/one', payload);
    expect(committed.data.warnings).toEqual(warnings);
    expect(provider._fetch.mock.calls[0][0]).toBe('/admin/v1/workforce/teams/team%2Fone/deletion');
    expect(provider._fetch.mock.calls[1][0]).toBe('/admin/v1/workforce/teams/team%2Fone/deletion');
    expect(JSON.parse(provider._fetch.mock.calls[1][1].body)).toEqual(payload);
    expect(provider._fetch).toHaveBeenCalledTimes(2);
  });

  it('reads the full canonical Workforce snapshot envelope without legacy requests', async () => {
    const provider = makeProvider();
    provider._fetch.mockResolvedValue(mockResponse({ jsonData: { content: WORKFORCE_SNAPSHOT } }));

    const result = await provider.getWorkforce();

    expect(result).toEqual({ ok: true, data: { content: WORKFORCE_SNAPSHOT } });
    expect(provider._fetch).toHaveBeenCalledTimes(1);
    expect(provider._fetch).toHaveBeenCalledWith('/admin/v1/workforce',
      expect.objectContaining({ method: 'GET' }));
  });

  it('saves the exact paired snapshot and preserves committed warnings', async () => {
    const provider = makeProvider();
    const warnings = [{ error: 'cost_cache_invalidation_failed', message: 'Saved; refresh failed' }];
    const committed = { ...WORKFORCE_SNAPSHOT, revision: 'committed-revision' };
    provider._fetch.mockResolvedValue(mockResponse({
      jsonData: { ok: true, content: committed, warnings },
    }));

    const result = await provider.saveWorkforce(WORKFORCE_SNAPSHOT);

    const [url, options] = provider._fetch.mock.calls[0];
    expect(url).toBe('/admin/v1/workforce');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body)).toEqual(WORKFORCE_SNAPSHOT);
    expect(result.data).toEqual({ ok: true, content: committed, warnings });
    expect(provider._fetch).toHaveBeenCalledTimes(1);
  });

  it('creates a supplier-scoped profile using only supplied editable fields and revision', async () => {
    const provider = makeProvider();
    const payload = METHOD_ARGS.createWorkforceDefinition[1];
    const committed = {
      ...WORKFORCE_SNAPSHOT,
      revision: 'profile-created',
      workforce: { schema_version: 2, staffing: [], suppliers: [{
        id: 'supplier-one', profiles: [{ id: 'server-issued-profile', ...payload.fields }],
      }] },
    };
    provider._fetch.mockResolvedValue(mockResponse({ jsonData: { ok: true, content: committed } }));

    const result = await provider.createWorkforceDefinition('profile', payload);

    const [url, options] = provider._fetch.mock.calls[0];
    expect(url).toBe('/admin/v1/workforce/definitions/profile');
    expect(JSON.parse(options.body)).toEqual(payload);
    expect(result.data.content.workforce.suppliers[0].profiles[0].id).toBe('server-issued-profile');
  });

  it('encodes definition kinds as one URL segment', async () => {
    const provider = makeProvider();
    provider._fetch.mockResolvedValue(mockResponse({ jsonData: { ok: true } }));

    await provider.createWorkforceDefinition('team/other', { revision: 'first', fields: {} });

    expect(provider._fetch.mock.calls[0][0]).toBe('/admin/v1/workforce/definitions/team%2Fother');
  });

  for (const [status, code] of [
    [401, 'access_denied'], [409, 'workforce_conflict'], [409, 'workforce_not_migrated'],
    [422, 'invalid_workforce'],
  ]) {
    it(`preserves ${code} details without retrying a Workforce write`, async () => {
      const provider = makeProvider();
      const detail = { error: code, message: 'Fixture server explanation' };
      provider._fetch.mockResolvedValue(mockResponse({
        ok: false, status, jsonData: { detail },
      }));

      const result = await provider.saveWorkforce(WORKFORCE_SNAPSHOT);

      expect(result.ok).toBe(false);
      expect(result.error.status).toBe(status);
      expect(result.error.detail).toEqual({ detail });
      expect(provider._fetch).toHaveBeenCalledTimes(1);
    });
  }
});
