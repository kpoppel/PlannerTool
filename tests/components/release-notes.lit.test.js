import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { showReleaseNotes } from '../../www/js/components/ReleaseNotes.lit.js';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
});

afterEach(() => {
  document.querySelectorAll('release-notes').forEach((element) => element.remove());
  vi.unstubAllGlobals();
});

it('does not open the reader for an acknowledged release', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    releaseId: 'v5.0.0', acknowledged: true,
  }))));
  await showReleaseNotes('/prefix/api');
  expect(document.querySelector('release-notes')).toBeNull();
});

it('opens a permanent page and acknowledges only on Continue', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ releaseId: 'v5.0.0', acknowledged: false })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ releaseId: 'v5.0.0', acknowledged: true })));
  vi.stubGlobal('fetch', fetch);
  const complete = showReleaseNotes('/prefix/api');
  await vi.waitFor(() => expect(document.querySelector('release-notes')).not.toBeNull());
  const reader = document.querySelector('release-notes');
  await reader.updateComplete;
  expect(reader.renderRoot.querySelector('iframe').getAttribute('src'))
    .toBe('/prefix/static/docs/releases/v5.0.0/index.html');
  expect(fetch).toHaveBeenCalledTimes(1);
  reader.renderRoot.querySelector('button').click();
  await complete;
  expect(fetch.mock.calls[1][0]).toBe('/prefix/api/auth/release-notes');
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ releaseId: 'v5.0.0' });
  expect(document.querySelector('release-notes')).toBeNull();
});

it('uses the Vite docs root for the release iframe and open-page link', async () => {
  const originalIsViteDev = window.IS_VITE_DEV;
  window.IS_VITE_DEV = true;
  const reader = document.createElement('release-notes');
  reader.apiBase = '/api';
  reader.releaseId = 'v5.0.0';
  document.body.appendChild(reader);
  await reader.updateComplete;

  expect(reader.pageUrl).toBe('/docs/releases/v5.0.0/index.html');
  expect(reader.renderRoot.querySelector('iframe').getAttribute('src'))
    .toBe('/docs/releases/v5.0.0/index.html');
  expect(reader.renderRoot.querySelector('a').getAttribute('href'))
    .toBe('/docs/releases/v5.0.0/index.html');

  reader.remove();
  if (originalIsViteDev === undefined) delete window.IS_VITE_DEV;
  else window.IS_VITE_DEV = originalIsViteDev;
});

it('keeps the reader open when acknowledgement fails and allows retry', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ releaseId: 'v5.0.0', acknowledged: false })))
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ releaseId: 'v5.0.0', acknowledged: true }))));
  const complete = showReleaseNotes('/api');
  await vi.waitFor(() => expect(document.querySelector('release-notes')).not.toBeNull());
  const reader = document.querySelector('release-notes');
  await reader.updateComplete;
  reader.renderRoot.querySelector('button').click();
  await vi.waitFor(() => expect(reader.error).toContain('Could not save'));
  await reader.updateComplete;
  expect(reader.renderRoot.querySelector('button').disabled).toBe(false);
  reader.renderRoot.querySelector('button').click();
  await complete;
});