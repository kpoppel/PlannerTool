// Local shim to expose `unsafeSVG` when a built vendor bundle isn't used.
// Prefer the exported symbol from the built bundle.
export { unsafeSVG } from './lit.bundle.js';
