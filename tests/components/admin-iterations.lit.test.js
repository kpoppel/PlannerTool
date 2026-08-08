import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { adminProvider } from '../../www/admin/js/services/providerREST.js';
import '../../www/admin/js/components/admin/Iterations.lit.js';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('admin-iterations', () => {
  let comp;
  const originals = {};

  beforeEach(() => {
    originals.getIterations = adminProvider.getIterations;
    originals.getAdo = adminProvider.getAdo;
    originals.browseAzureProjects = adminProvider.browseAzureProjects;
    originals.browseAreaPaths = adminProvider.browseAreaPaths;
    originals.browseIterations = adminProvider.browseIterations;
    originals.saveIterations = adminProvider.saveIterations;
    originals.deleteIterationSet = adminProvider.deleteIterationSet;
    originals.unassociateAllIterations = adminProvider.unassociateAllIterations;

    adminProvider.getIterations = vi.fn().mockResolvedValue({ iteration_sets: [] });
    adminProvider.getAdo = vi.fn().mockResolvedValue({ organization_url: 'MyOrg' });
    adminProvider.browseAzureProjects = vi.fn().mockResolvedValue({ projects: ['ProjA'] });
    adminProvider.browseAreaPaths = vi.fn().mockResolvedValue({ area_paths: ['ProjA\\Iteration\\Root'] });
    adminProvider.browseIterations = vi.fn().mockResolvedValue({ iterations: [] });
    adminProvider.saveIterations = vi.fn().mockResolvedValue({ ok: true });
    adminProvider.deleteIterationSet = vi.fn().mockResolvedValue({ ok: true });
    adminProvider.unassociateAllIterations = vi.fn().mockResolvedValue({ ok: true });

    comp = document.createElement('admin-iterations');
    document.body.appendChild(comp);
  });

  afterEach(() => {
    if (comp) comp.remove();
    adminProvider.getIterations = originals.getIterations;
    adminProvider.getAdo = originals.getAdo;
    adminProvider.browseAzureProjects = originals.browseAzureProjects;
    adminProvider.browseAreaPaths = originals.browseAreaPaths;
    adminProvider.browseIterations = originals.browseIterations;
    adminProvider.saveIterations = originals.saveIterations;
    adminProvider.deleteIterationSet = originals.deleteIterationSet;
    adminProvider.unassociateAllIterations = originals.unassociateAllIterations;
    vi.restoreAllMocks();
  });

  it('creates a set from selected browse path subtree only', async () => {
    await comp.updateComplete;
    comp.browseProject = 'ProjA';
    comp.browsedIterations = [
      { path: 'ProjA\\Iteration\\eSW\\Platform' },
      { path: 'ProjA\\Iteration\\eSW\\Platform\\2026\\Q1' },
      { path: 'ProjA\\Iteration\\eSW\\Platform\\2026\\Q1\\1' },
      { path: 'ProjA\\Iteration\\eSW\\Platform\\2026\\Q2' },
    ];
    comp.selectedPaths = new Set(['ProjA\\Iteration\\eSW\\Platform\\2026\\Q1']);

    comp.saveAsNewIterationSet();
    await comp.updateComplete;

    expect(comp.config.iteration_sets).to.have.length(1);
    const set = comp.config.iteration_sets[0];
    expect(set.source_project).to.equal('ProjA');
    expect(set.root_path).to.equal('eSW\\Platform\\2026\\Q1');
    const paths = set.values.map((v) => v.path);
    expect(paths).to.include('ProjA\\Iteration\\eSW\\Platform\\2026\\Q1');
    expect(paths).to.include('ProjA\\Iteration\\eSW\\Platform\\2026\\Q1\\1');
    expect(paths).to.not.include('ProjA\\Iteration\\eSW\\Platform');
    expect(paths).to.not.include('ProjA\\Iteration\\eSW\\Platform\\2026\\Q2');
  });

  it('creates a set from multiple selected roots including descendants', async () => {
    await comp.updateComplete;
    comp.browseProject = 'ProjA';
    comp.browsedIterations = [
      { path: 'ProjA\\Iteration\\FitXP' },
      { path: 'ProjA\\Iteration\\FitXP\\Sprint 1' },
      { path: 'ProjA\\Iteration\\FitXP\\Sprint 2' },
      { path: 'ProjA\\Iteration\\Ops' },
      { path: 'ProjA\\Iteration\\Ops\\Sprint A' },
    ];
    comp.selectedPaths = new Set([
      'ProjA\\Iteration\\FitXP',
      'ProjA\\Iteration\\Ops',
    ]);

    comp.saveAsNewIterationSet();
    await comp.updateComplete;

    expect(comp.config.iteration_sets).to.have.length(1);
    const set = comp.config.iteration_sets[0];
    expect(set.root_path).to.equal(null);
    const paths = set.values.map((v) => v.path).sort();
    expect(paths).to.deep.equal([
      'ProjA\\Iteration\\FitXP',
      'ProjA\\Iteration\\FitXP\\Sprint 1',
      'ProjA\\Iteration\\FitXP\\Sprint 2',
      'ProjA\\Iteration\\Ops',
      'ProjA\\Iteration\\Ops\\Sprint A',
    ]);
  });

  it('filters using project-relative iteration path', async () => {
    await comp.updateComplete;
    comp.browseProject = 'SW';
    comp.browsedIterations = [
      { path: 'SW\\Iteration\\FitXP' },
      { path: 'SW\\Iteration\\Core' },
    ];
    comp.filterText = 'fit';

    const filtered = comp.filteredIterations;

    expect(filtered).to.have.length(1);
    expect(comp.stripIterationPrefix(filtered[0].path)).to.equal('FitXP');
  });

  it('handles 409 delete by unassociating then retrying delete', async () => {
    await comp.updateComplete;
    comp.config = {
      iteration_sets: [
        {
          id: 'set-1',
          name: 'Set One',
          source_project: 'ProjA',
          root_path: 'Root',
          values: [],
          cached_at: null,
        },
      ],
    };

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    adminProvider.deleteIterationSet = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          message: 'HTTP 409',
          status: 409,
          detail: {
            error: 'referenced_by_projects',
            projects: [{ name: 'ProjX' }],
          },
        },
      })
      .mockResolvedValueOnce({ ok: true });
    adminProvider.unassociateAllIterations = vi.fn().mockResolvedValue({ ok: true, unassociated: 1 });

    await comp.deleteSet(0);
    await flush();

    expect(confirmSpy).toHaveBeenCalled();
    expect(adminProvider.unassociateAllIterations).toHaveBeenCalledWith('set-1');
    expect(adminProvider.deleteIterationSet).toHaveBeenCalledTimes(2);
    expect(comp.config.iteration_sets).to.have.length(0);
    expect(comp.statusType).to.equal('success');
  });
});
