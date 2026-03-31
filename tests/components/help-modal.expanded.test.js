import { expect } from '@esm-bundle/chai';
import { vi } from 'vitest';
import '../../www/js/components/HelpModal.lit.js';

describe('HelpModal expanded tests', () => {
  it('loads a document from index and renders markdown content', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => {
      if (url.endsWith('/static/docs/index.json')) {
        return { ok: true, json: async () => [{ title: 'Doc A', file: 'a.md' }] };
      }
      if (url.endsWith('/static/docs/a.md')) {
        return { ok: true, text: async () => '# Title\nSome **bold** text' };
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

    el.remove();
    global.fetch = originalFetch;
  });

  it('will open onboarding if onboarding-modal exists', async () => {
    // create a minimal fake onboarding-modal so _showOnboarding finds it
    class FakeOnboarding extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        const m = document.createElement('modal-lit');
        this.shadowRoot.appendChild(m);
      }
    }
    if (!customElements.get('onboarding-modal')) {
      customElements.define('onboarding-modal', FakeOnboarding);
    }

    const el = document.createElement('help-modal');
    document.body.appendChild(el);
    // call show onboarding and ensure no exception
    await el._showOnboarding();
    // cleanup
    el.remove();
    const existing = document.querySelector('onboarding-modal');
    if (existing) existing.remove();
  });
});
