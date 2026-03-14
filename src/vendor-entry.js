// Entry file for bundling Lit and commonly-used directives into a single ESM bundle
// Re-export everything from `lit` so the bundle exposes named exports like
// `html`, `css`, `LitElement`, etc. Also re-export commonly-used directives.
export * from 'lit';
export { unsafeSVG } from 'lit-html/directives/unsafe-svg.js';
export { repeat } from 'lit-html/directives/repeat.js';
