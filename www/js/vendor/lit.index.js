// Re-export Lit for browsers from a CDN-friendly ESM bundle.
// Using esm.sh provides a single entrypoint that the browser can import.
// This avoids bare specifier imports like "@lit/reactive-element" which
// the browser cannot resolve without an import map or bundler.
// Prefer a local vendor shim that can be swapped for an actual bundled file.
export * from './lit.bundle.local.js';

//# sourceMappingURL=index.js.map
