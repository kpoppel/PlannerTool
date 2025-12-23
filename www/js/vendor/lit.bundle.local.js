// Local shim entrypoint for Lit.
// By default this re-exports the Lit bundle from a CDN so tests and the dev server work.
// For an offline, pre-bundled setup replace the contents of this file with the
// bundled ESM build of Lit (for example, the output of a small bundling step).

export * from 'https://esm.sh/lit@3.3.1';

// NOTE: To fully vendor Lit, replace this file with a copy of the ESM build
// (e.g. lit.esm.js) and ensure all bare specifier imports inside it are
// resolved to local paths. Keeping this single local file makes that process
// straightforward and keeps the rest of the codebase importing from
// '../vendor/lit.js' unchanged.
