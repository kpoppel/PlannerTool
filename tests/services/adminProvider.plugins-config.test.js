import { expect, afterEach, beforeEach, describe, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import { adminProvider } from '../../www-admin/js/services/providerREST.js';

const VALID_CONFIG = {
  schema_version: 1,
  plugins: [{ id: 'plugin-alpha', enabled: true, activated: false }],
};

describe('adminProvider plugins-config API contract', () => {
  afterEach(() => {
    server.resetHandlers();
  });

  it('getPluginsConfig returns parsed content and null on HTTP error', async () => {
    server.use(
      http.get('/admin/v1/plugins-config', () =>
        HttpResponse.json({ content: VALID_CONFIG }, { status: 200 })
      )
    );

    const ok = await adminProvider.getPluginsConfig();
    expect(ok).to.deep.equal(VALID_CONFIG);

    server.use(
      http.get('/admin/v1/plugins-config', () => HttpResponse.json({}, { status: 500 }))
    );

    const failed = await adminProvider.getPluginsConfig();
    expect(failed).to.equal(null);
  });

  it('savePluginsConfig wraps payload content and returns error on HTTP failure', async () => {
    let body = null;

    server.use(
      http.post('/admin/v1/plugins-config', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true }, { status: 200 });
      })
    );

    const saved = await adminProvider.savePluginsConfig(VALID_CONFIG);
    expect(saved.ok).to.equal(true);
    expect(body.content).to.deep.equal(VALID_CONFIG);

    server.use(
      http.post('/admin/v1/plugins-config', async () =>
        HttpResponse.json({ error: 'bad' }, { status: 400 })
      )
    );

    const failed = await adminProvider.savePluginsConfig(VALID_CONFIG);
    expect(failed.ok).to.equal(false);
    expect(failed.error).to.include('400');
  });
});
