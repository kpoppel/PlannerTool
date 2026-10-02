import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataService } from '../../www/js/services/dataService.js';

describe('dataService REST Result contract', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns provider failures without replacing them with an empty payload', async () => {
    const failure = {
      ok: false,
      error: { message: 'projects_unavailable', status: 503 },
    };
    vi.spyOn(dataService.providers.rest, 'getProjects').mockResolvedValue(failure);

    await expect(dataService.getProjects()).resolves.toBe(failure);
  });
});