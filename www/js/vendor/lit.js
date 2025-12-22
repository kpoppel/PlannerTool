// Local shim that re-exports Lit from bundled vendor files in /www/js/vendor.
// This avoids CDN usage and makes Lit available via a stable local path.
// TODO: Not quite working yet - needs further investigation.
// Re-export from the bundled local vendor file so the app serves Lit from /static/js/vendor/
// This keeps browser imports like `/static/js/vendor/lit.js` local and avoids CDN fetches.
export * from './lit.index.js';
//Option 2 (to keep):
// Local shim that re-exports Lit for browsers.
// This avoids having to change many imports and lets the dev server serve a stable path.
//export * from 'https://esm.sh/lit@3.3.1';
