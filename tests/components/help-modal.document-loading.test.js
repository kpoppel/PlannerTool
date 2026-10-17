import { expect } from '@esm-bundle/chai';
import { vi } from 'vitest';
import documentationIndex from '../../www/docs/index.json';
import '../../www/js/components/HelpModal.lit.js';

describe('HelpModal document loading and onboarding', () => {
  it('loads a document from index and renders markdown content', async () => {
    const originalFetch = global.fetch;
    const originalIsViteDev = window.IS_VITE_DEV;
    window.IS_VITE_DEV = true;
    global.fetch = vi.fn(async (url) => {
      if (url.endsWith('/docs/index.json')) {
        return { ok: true, json: async () => [{ title: 'Doc A', file: 'a.md' }] };
      }
      if (url.endsWith('/docs/a.md')) {
        return { ok: true, text: async () => '# Title\nSome **bold** text\n\n![Diagram](sample.png)' };
      }
      return { ok: false, status: 404 };
    });

    const el = document.createElement('help-modal');
    document.body.appendChild(el);

    // wait until content is loaded
    for (let i = 0; i < 50; i++) {
      if (el.content && el.content.includes('Some')) break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(el.content).to.include('<h1>');
    expect(el.content).to.include('<strong>');
    expect(el.content).to.include('src="/docs/sample.png"');
    expect(global.fetch.mock.calls.map((call) => call[0])).to.deep.equal([
      '/docs/index.json', '/docs/a.md',
    ]);

    el.remove();
    global.fetch = originalFetch;
    if (originalIsViteDev === undefined) delete window.IS_VITE_DEV;
    else window.IS_VITE_DEV = originalIsViteDev;
  });

  it('shows the release page inside the documentation panel', async () => {
    const originalIsViteDev = window.IS_VITE_DEV;
    window.IS_VITE_DEV = true;
    const el = document.createElement('help-modal');
    el._loadIndex = async () => {};
    document.body.appendChild(el);
    await el.updateComplete;
    const releaseDoc = documentationIndex.find((doc) => doc.title === "What's New in v5.0.0");
    expect(releaseDoc).not.to.equal(undefined);
    await el._selectDoc(releaseDoc);
    await el.updateComplete;

    const frame = el.renderRoot.querySelector('.help-panel iframe');
    expect(frame.getAttribute('src')).to.equal('/docs/releases/v5.0.0/index.html');
    expect(frame.title).to.equal("What's New in v5.0.0");

    el.remove();
    if (originalIsViteDev === undefined) delete window.IS_VITE_DEV;
    else window.IS_VITE_DEV = originalIsViteDev;
  });

  it('lists the enrollment overview as an HTML documentation page', () => {
    const overview = documentationIndex.find((doc) => doc.file === 'onboarding/index.html');
    expect(overview.title).to.equal('About PlannerTool & Enrollment');
    expect(overview.format).to.equal('html');
  });
});
