#!/usr/bin/env bash
# Prepare a clone for development. Safe to re-run: each step is skipped when its inputs are
# unchanged, so pulling new Python/Node dependencies only re-applies the affected steps.
#
# Usage: scripts/setup-dev.sh [--force]   (--force re-runs every step)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$PWD"
VENV="$ROOT/.venv"
STAMPS="$VENV/.setup-stamps"
MIN_PYTHON="3.13"
MIN_NODE_MAJOR=20
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }
skip() { printf '    up to date, skipped\n'; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# Stamp = hash of the step inputs; the step re-runs when the hash changes or is missing.
inputs_hash() { cat "$@" | sha256sum | cut -d' ' -f1; }
is_current() { [[ $FORCE -eq 0 && -f "$STAMPS/$1" && "$(cat "$STAMPS/$1")" == "$2" ]]; }
mark_done() { mkdir -p "$STAMPS"; printf '%s' "$2" > "$STAMPS/$1"; }

step "Checking prerequisites"
PYTHON="${PYTHON:-python3}"
command -v "$PYTHON" >/dev/null || die "$PYTHON not found; install Python >= $MIN_PYTHON"
"$PYTHON" -c "import sys; sys.exit(sys.version_info < tuple(map(int, '$MIN_PYTHON'.split('.'))))" \
  || die "Python >= $MIN_PYTHON required, found $("$PYTHON" --version)"
"$PYTHON" -c 'import venv, ensurepip' 2>/dev/null \
  || die "Python venv support missing; install it (e.g. sudo apt install python3-venv)"
command -v node >/dev/null || die "node not found; install Node.js >= $MIN_NODE_MAJOR (see README: nvm install --lts)"
command -v npm >/dev/null || die "npm not found"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
(( node_major >= MIN_NODE_MAJOR )) || die "Node.js >= $MIN_NODE_MAJOR required, found $(node --version)"
echo "    $("$PYTHON" --version), node $(node --version), npm $(npm --version)"

step "Python virtual environment (.venv)"
# A venv whose interpreter no longer runs (e.g. system Python upgraded) is rebuilt.
if [[ -x "$VENV/bin/python" ]] && "$VENV/bin/python" -c 'pass' 2>/dev/null; then
  skip
else
  [[ -e "$VENV" ]] && echo "    existing .venv is broken, recreating"
  rm -rf "$VENV"
  "$PYTHON" -m venv "$VENV"
fi

step "Python dependencies (requirements.txt, requirements-dev.txt)"
py_hash="$(inputs_hash requirements.txt requirements-dev.txt; "$VENV/bin/python" --version)"
if is_current python-deps "$py_hash"; then
  skip
else
  "$VENV/bin/python" -m pip install --quiet --upgrade pip
  "$VENV/bin/python" -m pip install --quiet -r requirements.txt -r requirements-dev.txt
  mark_done python-deps "$py_hash"
fi

step "Node dependencies (package.json)"
# package-lock.json is gitignored, so npm ci is not an option on a fresh clone.
node_hash="$(inputs_hash package.json; node --version)"
if is_current node-deps "$node_hash" && [[ -d node_modules ]]; then
  skip
else
  npm install --no-audit --no-fund
  mark_done node-deps "$node_hash"
fi

step "Playwright browser (chromium)"
chromium_path="$(node --input-type=module -e 'import { chromium } from "playwright"; console.log(chromium.executablePath())')"
if [[ $FORCE -eq 0 && -x "$chromium_path" ]]; then
  skip
else
  # On OS releases newer than Playwright knows, set e.g. PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64.
  npx --no-install playwright install chromium \
    || die "Playwright browser install failed; see the hint in scripts/setup-dev.sh"
fi

step "Git hooks"
if [[ "$(git config --get core.hooksPath || true)" == ".githooks" ]]; then
  skip
else
  bash scripts/setup-git-hooks.sh
fi

step "Editor and agent config (scripts/dev-config -> .vscode/, .github/)"
# These directories are gitignored. Files are installed or updated from the tracked templates,
# but a file edited locally since the last install is kept and reported instead.
file_hash() { sha256sum "$1" | cut -d' ' -f1; }
while IFS= read -r template; do
  rel="${template#scripts/dev-config/}"
  target=".${rel}"
  stamp="config-${rel//\//_}"
  if [[ ! -e "$target" ]]; then
    mkdir -p "$(dirname "$target")"
    cp "$template" "$target"
    echo "    created $target"
  elif cmp -s "$template" "$target"; then
    :
  elif [[ -f "$STAMPS/$stamp" && "$(cat "$STAMPS/$stamp")" == "$(file_hash "$target")" ]]; then
    cp "$template" "$target"
    echo "    updated $target"
  else
    echo "    kept locally modified $target (compare: diff $target $template)"
    continue
  fi
  mark_done "$stamp" "$(file_hash "$target")"
done < <(find scripts/dev-config -type f | sort)

step "Done"
echo "    Activate the venv with: source .venv/bin/activate"
echo "    Start developing with:  ./scripts/run_dev.sh"
