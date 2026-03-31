import { expect } from '@esm-bundle/chai';
import { vi } from 'vitest';
import { HelpModal } from '../../www/js/components/HelpModal.lit.js';

describe('HelpModal unit tests', () => {
  it('_escapeHtml and _inline and _renderMarkdown produce expected HTML snippets', () => {
    const hm = new HelpModal();
    expect(hm._escapeHtml('<&>')).to.equal('&lt;&amp;&gt;');

    const md = '# Heading\nParagraph with **bold** and *italic* and `code`.\n![alt](img.png)\n[link](http://example.com)\n- item1\n1. one\n```js\nconsole.log(1);\n```';
    const out = hm._renderMarkdown(md, 'doc.md');
    expect(out).to.include('<h1>');
    expect(out).to.include('<strong>');
    expect(out).to.include('<em>');
    expect(out).to.include('<code');
    expect(out).to.include('<img');
    expect(out).to.include('<a href="http://example.com"');
  });

  it('_filteredIndex filters by query and returns whole index when query empty', () => {
    const hm = new HelpModal();
    hm.index = [
      { title: 'Alpha One', tags: ['x', 'y'], file: 'a.md' },
      { title: 'Beta Two', tags: [], file: 'b.md' },
    ];
    hm.query = 'alpha';
    const filtered = hm._filteredIndex();
    expect(filtered.length).to.equal(1);
    hm.query = '';
    expect(hm._filteredIndex().length).to.equal(2);
  });

  it('connected flow handles empty index fetch gracefully', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => {
      if (url.endsWith('/static/docs/index.json')) {
        return { ok: true, json: async () => [] };
      }
      return { ok: false, status: 404 };
    });

    const el = document.createElement('help-modal');
    document.body.appendChild(el);
    // wait for lifecycle and async fetch logic to settle (poll a few times)
    let settled = false;
    for (let i = 0; i < 20; i++) {
      if (el.content && el.content.length) {
        settled = true;
        break;
      }
      // allow microtasks and timers to run
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(settled).to.equal(true);
    expect(el.content).to.include('No documentation found');
    el.remove();

    global.fetch = originalFetch;
  });
});
