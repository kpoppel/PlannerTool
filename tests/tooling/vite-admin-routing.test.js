import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import viteConfig from '../../vite.config.js';

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