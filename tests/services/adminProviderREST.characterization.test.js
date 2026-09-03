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

const METHOD_ARGS = {
  saveAreaMappings: [{ a: 1 }],
  saveProjects: [{ projects: [] }],
  saveSystem: [{ system: true }],
  saveAdo: [{ org: 'https://example' }],
  saveEventsConfig: [{ events: [] }],
  saveGroupsConfig: [{ groups: [] }],
  saveTeams: [{ teams: [] }],
  savePeople: [{ people: [] }],
  saveCost: [{ rates: [] }],
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
  'getTeams',
  'saveTeams',
  'getPeople',
  'savePeople',
  'getPeopleInspect',
  'getCostInspect',
  'getCost',
  'saveCost',
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
});
