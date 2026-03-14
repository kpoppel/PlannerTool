// Re-export Lit from the built local bundle.
// The build produces `www/js/vendor/lit.bundle.js` which contains Lit and
// commonly used directives. This replaces the previous esm.sh-based shim.
// Re-export everything from the built bundle. Exports must be top-level.
export * from './lit.bundle.js';

