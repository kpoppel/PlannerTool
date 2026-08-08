import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { adminProvider } from '../../../www/admin/js/services/providerREST.js';
import {
  onWikiOrgUrlInput,
  onWikiOrgUrlCommit,
  fetchProjects,
  fetchWikis,
  fetchWikiPages,
} from '../../../www/admin/js/components/admin/datasources/plan-events-row.js';

function makeComp() {
  return {
    _wikiOrgUrl: '',
    _wikiProject: 'OldProject',
    _wikiId: 'OldWiki',
    _wikiPages: ['/Old/Page'],
    _wikis: [{ name: 'OldWiki' }],
    _projects: ['OldProject'],
    _projectsError: 'old projects error',
    _wikisError: 'old wikis error',
    _wikiPagesError: 'old pages error',
    _projectsLoading: false,
  };
}

describe('plan-events-row org input helper', () => {
  const originalBrowseAzureProjects = adminProvider.browseAzureProjects;
  const originalBrowseWikis = adminProvider.browseWikis;
  const originalBrowseWikiPages = adminProvider.browseWikiPages;

  beforeEach(() => {
    adminProvider.browseAzureProjects = vi.fn().mockResolvedValue({
      ok: true,
      data: { projects: ['ProjA', 'ProjB'] },
    });
  });

  afterEach(() => {
    adminProvider.browseAzureProjects = originalBrowseAzureProjects;
    adminProvider.browseWikis = originalBrowseWikis;
    adminProvider.browseWikiPages = originalBrowseWikiPages;
  });

  it('reloads projects only on commit and resets dependent fields', async () => {
    const comp = makeComp();

    onWikiOrgUrlInput(comp, 'MyOrg');

    await Promise.resolve();
    expect(adminProvider.browseAzureProjects).not.toHaveBeenCalled();

    onWikiOrgUrlCommit(comp);

    // fetchProjects runs asynchronously.
    await Promise.resolve();
    await Promise.resolve();

    expect(adminProvider.browseAzureProjects).toHaveBeenCalledWith('MyOrg');
    expect(comp._wikiOrgUrl).toBe('MyOrg');
    expect(comp._wikiProject).toBe('');
    expect(comp._wikiId).toBe('');
    expect(comp._wikis).toEqual([]);
    expect(comp._wikiPages).toEqual([]);
    expect(comp._projects).toEqual(['ProjA', 'ProjB']);
    expect(comp._projectsError).toBe('');
    expect(comp._wikisError).toBe('');
    expect(comp._wikiPagesError).toBe('');
  });

  it('does not reload when org URL is unchanged (ignoring surrounding whitespace)', async () => {
    const comp = makeComp();
    comp._wikiOrgUrl = 'MyOrg';

    // Establish committed baseline.
    onWikiOrgUrlCommit(comp);

    onWikiOrgUrlInput(comp, '  MyOrg  ');
    onWikiOrgUrlCommit(comp);

    await Promise.resolve();

    expect(adminProvider.browseAzureProjects).not.toHaveBeenCalled();
  });

  it('fetchProjects handles Result error objects without throwing', async () => {
    const comp = makeComp();
    comp._wikiOrgUrl = 'MyOrg';
    adminProvider.browseAzureProjects = vi.fn().mockResolvedValue({
      ok: false,
      error: { message: 'PAT missing' },
    });

    await fetchProjects(comp);

    expect(comp._projectsError).to.include('Personal Access Token is required');
    expect(comp._projectsLoading).toBe(false);
  });

  it('fetchWikis and fetchWikiPages use error.message from Result failures', async () => {
    const comp = makeComp();
    adminProvider.browseWikis = vi.fn().mockResolvedValue({
      ok: false,
      error: { message: 'wiki backend unavailable' },
    });
    adminProvider.browseWikiPages = vi.fn().mockResolvedValue({
      ok: false,
      error: { message: 'pages backend unavailable' },
    });

    await fetchWikis(comp, 'ProjectA');
    expect(comp._wikisError).to.include('wiki backend unavailable');

    await fetchWikiPages(comp, 'ProjectA', 'WikiA');
    expect(comp._wikiPagesError).to.include('pages backend unavailable');
  });
});
