#!/usr/bin/env bash
# scripts/vendor-lit.sh
# Create a local lit vendor bundle that re-exports Lit and unsafeSVG
# Usage: ./scripts/vendor-lit.sh
set -euo pipefail
OUT="www/js/vendor/lit.bundle.local.js"
cat > "$OUT" <<'EOF'
// Auto-generated local vendor shim for Lit and unsafeSVG
// This file re-exports the Lit package and the unsafeSVG directive
// from esm.sh to provide a single local entrypoint for the app.
export * from 'https://esm.sh/lit@3.3.1';
export { unsafeSVG } from 'https://esm.sh/lit-html@2.7.5/directives/unsafe-svg.js';
EOF

echo "Wrote $OUT"
