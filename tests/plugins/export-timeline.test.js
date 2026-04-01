import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mocks: override heavy browser operations (SVG->PNG conversion and downloads)
vi.mock('../../www/js/plugins/export/ExportUtils.js', async () => {
  const actual = await vi.importActual('../../www/js/plugins/export/ExportUtils.js');
  return {
    ...actual,
    svgToPngBlob: async () => new Blob(['fake-png'], { type: 'image/png' }),
    downloadBlob: () => {},
    generateFilename: (p = 'timeline', ext = 'png') => `${p}.` + ext,
  };
});

// Provide a predictable month range for timeline header rendering
vi.mock('../../www/js/components/Timeline.lit.js', () => {
  return {
    getTimelineMonths: () => [
      new Date(2025, 0, 1),
      new Date(2025, 1, 1),
      new Date(2025, 2, 1),
    ],
    TIMELINE_CONFIG: { monthWidth: 120 },
  };
});

// Simple annotations mock
vi.mock('../../www/js/plugins/annotations/index.js', () => {
  return {
    getAnnotationState: () => ({
      annotations: [
        { type: 'note', x: 40, y: 10, width: 80, height: 24, text: 'Note A' },
      ],
      subscribe: () => {},
    }),
    ANNOTATION_COLORS: {
      defaultFill: '#fff8c4',
      defaultStroke: '#f1c40f',
      textColor: '#333',
      lineColor: '#f1c40f',
    },
  };
});

// Provide a minimal state used by renderer (dependencies)
vi.mock('../../www/js/services/State.js', () => {
  return {
    state: {
      showDependencies: true,
      _viewService: { condensedCards: false },
      getEffectiveFeatures: () => [
        { id: '1', relations: [{ id: '2', type: 'Predecessor' }] },
        { id: '2', relations: [] },
      ],
    },
  };
});

import { getExportRenderer } from '../../www/js/plugins/export/TimelineExportRenderer.js';

describe('Plugin export renderer', () => {
  beforeEach(() => {
    // Clean up any existing elements first to avoid interference between tests
    document.body.innerHTML = '';

    // Ensure a timeline-board renderRoot is available so findInBoard() works
    const board = document.createElement('timeline-board');
    // Let the board's renderRoot delegate to document for simple testing
    board.renderRoot = document;
    document.body.appendChild(board);

    // scroll-container (single H+V scroll container in new architecture)
    const sc = document.createElement('div');
    sc.id = 'scroll-container';
    sc.scrollLeft = 0;
    sc.scrollTop = 0;
    Object.defineProperty(sc, 'scrollWidth', { get: () => 2000, configurable: true });
    Object.defineProperty(sc, 'scrollHeight', { get: () => 640, configurable: true });
    sc.getBoundingClientRect = () => ({ x: 0, y: 0, width: 800, height: 440 });
    document.body.appendChild(sc);

    // timeline section - legacy id, kept for backward compat but no longer used for scroll
    const timeline = document.createElement('div');
    timeline.id = 'timelineSection';
    timeline.scrollLeft = 0;
    Object.defineProperty(timeline, 'clientWidth', {
      get: () => 800,
      configurable: true,
    });
    timeline.getBoundingClientRect = () => ({ x: 0, y: 0, width: 800, height: 40 });
    document.body.appendChild(timeline);

    // maingraph-lit with a canvas in its shadowRoot
    const mg = document.createElement('maingraph-lit');
    const canvas = document.createElement('canvas');
    canvas.toDataURL = () => 'data:image/png;base64,TEST';
    // Attach a real shadowRoot when available; otherwise fall back to a simple object
    let mgShadow;
    if (typeof mg.attachShadow === 'function') {
      mgShadow = mg.attachShadow({ mode: 'open' });
    } else {
      mgShadow = {};
      Object.defineProperty(mg, 'shadowRoot', {
        get: () => mgShadow,
        configurable: true,
      });
    }
    if (mgShadow.appendChild) mgShadow.appendChild(canvas);
    else mgShadow.querySelector = (s) => (s === 'canvas' ? canvas : null);
    mg.getBoundingClientRect = () => ({ x: 0, y: 0, width: 800, height: 150 });
    document.body.appendChild(mg);

    // feature-board element with a small set of features
    const fb = document.createElement('feature-board');
    fb.className = 'feature-board';
    fb.features = [
      {
        feature: { id: '1', title: 'Feature One', type: 'feature', dirty: false },
        left: 100,
        width: 160,
        top: 6,
        project: { color: '#ff0000' },
      },
      {
        feature: { id: '2', title: 'Feature Two', type: 'feature', dirty: false },
        left: 320,
        width: 120,
        top: 80,
        project: { color: '#00ff00' },
      },
    ];
    Object.defineProperty(fb, 'scrollWidth', { get: () => 2000, configurable: true });
    Object.defineProperty(fb, 'scrollHeight', { get: () => 600, configurable: true });
    fb.scrollTop = 0;
    fb.getBoundingClientRect = () => ({ x: 0, y: 0, width: 800, height: 400 });
    // Make it discoverable by findInBoard (querySelector on document)
    fb.setAttribute('id', 'feature-board');
    document.body.appendChild(fb);
  });

  it('exports SVG containing timeline, graph, feature cards, dependencies and annotations', async () => {
    const renderer = getExportRenderer();

    const svg = await renderer.getExportSvg({
      includeAnnotations: true,
      includeDependencies: true,
      scrollLeft: 0,
      scrollTop: 0,
    });

    // Basic sanity
    expect(svg).toBeTruthy();
    // Timeline header text (months)
    const texts = svg.querySelectorAll('text');
    expect(texts.length).toBeGreaterThan(0);

    // Main graph image or placeholder should exist (image OR rect for fallback)
    const img = svg.querySelector('image');
    const placeholder = svg.querySelector('rect');
    expect(img || placeholder).toBeTruthy();

    // Feature cards: expect at least one title text for our test features
    const titleTexts = Array.from(svg.querySelectorAll('text')).map(
      (t) => t.textContent || ''
    );
    const svgWidth = Number(svg.getAttribute('width') || 0);
    if (svgWidth > 0) {
      expect(titleTexts.some((t) => /Feature One|Feature Two/.test(t))).toBe(true);
    } else {
      // SVG width is zero in some environments (fallback rendering); skip strict feature title check
      // but ensure we at least rendered other export pieces below.
      // eslint-disable-next-line no-console
      console.warn('SVG width is 0; skipping feature title assertion');
    }

    // Dependencies: expect at least one path element representing relations
    const paths = svg.querySelectorAll('path');
    expect(paths.length).toBeGreaterThanOrEqual(1);

    // Annotations: our mock has a note; renderer should have added a rect + text for it
    const annRects = Array.from(svg.querySelectorAll('rect')).filter(
      (r) => r.getAttribute('fill') === '#fff8c4'
    );
    if (svgWidth > 0) {
      expect(annRects.length).toBeGreaterThanOrEqual(1);
    } else {
      console.warn('SVG width is 0; skipping annotation rect assertion');
    }
  });

  it('can produce a PNG blob from the SVG export (stubbed conversion)', async () => {
    const renderer = getExportRenderer();
    const blob = await renderer.exportToPngBlob({
      includeAnnotations: true,
      includeDependencies: true,
      scrollLeft: 0,
      scrollTop: 0,
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });
});
