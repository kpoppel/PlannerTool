#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .encryption_key ]]; then
	echo "Missing .encryption_key in project root: $ROOT_DIR" >&2
	exit 1
fi

PLANNER_SECRET_KEY="$(cat .encryption_key)"

cleanup() {
	local exit_code=$?
	trap - INT TERM EXIT

	if [[ -n "${VITE_PID:-}" ]]; then
		kill "$VITE_PID" 2>/dev/null || true
	fi
	if [[ -n "${UVICORN_PID:-}" ]]; then
		kill "$UVICORN_PID" 2>/dev/null || true
	fi

	wait 2>/dev/null || true
	exit "$exit_code"
}

trap cleanup INT TERM EXIT

PLANNER_SECRET_KEY="$PLANNER_SECRET_KEY" \
	uvicorn planner:make_app --port 8001 --factory --reload 2>&1 | tee logfile.log &
UVICORN_PID=$!

npx vite --host 0.0.0.0 &
VITE_PID=$!

wait "$VITE_PID"
