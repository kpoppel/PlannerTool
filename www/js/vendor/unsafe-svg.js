// Local shim to expose unsafeSVG directive when vendor bundle doesn't include it.
// This re-exports the directive from esm.sh so the browser can load it.
// If you prefer a fully offline vendor bundle, follow the rebuild instructions in README.

export { unsafeSVG } from 'https://esm.sh/lit-html@3.3.1/directives/unsafe-svg.js';
