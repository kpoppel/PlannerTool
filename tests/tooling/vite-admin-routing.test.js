import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import viteConfig from '../../vite.config.js';

vi.mock('../../www/js/services/authStartup.js', () => ({
  initializeAuthentication: vi.fn(),
  showAuthenticationStartupFailure: vi.fn(),
}));
vi.mock('../../www/js/components/AuthStatus.lit.js', () => ({}));

describe('Admin login access decisions', () => {
  let dom;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it.each([
    [401, ''],
    [403, 'This account has no administration permissions.'],
    [503, 'Unable to check administration access. Please try again.'],
  ])('distinguishes access-check status %s after sign-in', async (status, message) => {
    dom = new JSDOM('<div class="login-card"><p id="error-message" style="display:none"></p>'
      + '<p id="login-guidance"></p><a id="planner-link"></a></div>',
    { url: 'http://localhost:5173/dev/admin/login' });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('CustomEvent', dom.window.CustomEvent);
    window.APP_BASE_URL = '/dev';
    const startup = await import('../../www/js/services/authStartup.js');
    startup.initializeAuthentication.mockResolvedValue({ state: { account: null } });
    const request = vi.fn().mockResolvedValue({ ok: false, status });
    vi.stubGlobal('fetch', request);

    await import('../../www/admin/js/login.js');
    const indicator = document.querySelector('auth-status');
    indicator.dispatchEvent(new CustomEvent('auth-complete', { detail: true }));

    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledOnce();
      expect(document.getElementById('error-message').textContent).toBe(message);
    });
    expect(document.getElementById('error-message').style.display)
      .toBe(status === 401 ? 'none' : 'block');
    expect(request.mock.calls[0][0]).toBe('/dev/admin/check');
    expect(request.mock.calls[0][1].headers.Accept).toBe('application/json');
  });
});

describe('Vite admin authentication routing', () => {
  it('proxies the admin permission check to the same backend as the API', () => {
    expect(viteConfig.server.proxy['/admin/check']).toEqual(viteConfig.server.proxy['/api']);
  });
});

describe('Application entry URL routing', () => {
  it.each([
    ['index.html', '/', ''],
    ['index.html', '/static/', ''],
    ['index.html', '/static/index.html', ''],
    ['index.html', '/tenant/', '/tenant'],
    ['index.html', '/tenant/static/', '/tenant'],
    ['admin/index.html', '/admin/', ''],
    ['admin/index.html', '/static/admin/', ''],
    ['admin/index.html', '/static/admin/index.html', ''],
    ['admin/index.html', '/tenant/admin/', '/tenant'],
    ['admin/index.html', '/tenant/static/admin/', '/tenant'],
    ['admin/login.html', '/admin/login', ''],
    ['admin/login.html', '/admin/login.html', ''],
    ['admin/login.html', '/static/admin/login.html', ''],
    ['admin/login.html', '/tenant/admin/login', '/tenant'],
    ['admin/login.html', '/tenant/static/admin/login.html', '/tenant'],
  ])('resolves %s at %s to API base %s', (entry, pathname, expected) => {
    const html = readFileSync(new URL(`../../www/${entry}`, import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: `http://localhost:5173${pathname}`, runScripts: 'outside-only' });
    try {
      const bootstrap = [...dom.window.document.querySelectorAll('script')]
        .find((script) => script.textContent.includes('window.APP_BASE_URL ='));
      dom.window.eval(bootstrap.textContent);
      expect(dom.window.APP_BASE_URL).toBe(expected);
    } finally {
      dom.window.close();
    }
  });
});