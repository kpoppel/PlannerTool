#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "${1:-}" == '--help' ]]; then
	echo 'Usage: scripts/run_dev.sh [--auth-env /absolute/path/to/protected.env]'
	echo 'The trusted shell env file configures a local Entra/mock broker and instance routing.'
	exit 0
fi

if [[ $# -gt 0 ]]; then
	if [[ $# -ne 2 || "$1" != '--auth-env' ]]; then
		echo 'Usage: scripts/run_dev.sh [--auth-env /absolute/path/to/protected.env]' >&2
		exit 1
	fi
	AUTH_ENV="$2"
	if [[ ! -f "$AUTH_ENV" ]]; then
		echo 'Authentication env file does not exist.' >&2
		exit 1
	fi
	PERMISSIONS="$(stat -c '%a' "$AUTH_ENV")"
	if (( (8#$PERMISSIONS & 077) != 0 )); then
		echo 'Authentication env file must not be accessible to group or other users (use chmod 600).' >&2
		exit 1
	fi
	set -a
	source "$AUTH_ENV"
	set +a
	: "${PLANNER_AUTH_INSTANCE:?Authentication env requires PLANNER_AUTH_INSTANCE}"
fi

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
	if [[ -n "${BROKER_PID:-}" ]]; then
		kill "$BROKER_PID" 2>/dev/null || true
	fi

	wait 2>/dev/null || true
	exit "$exit_code"
}

trap cleanup INT TERM EXIT

UVICORN_ARGS=(--port "${PLANNER_DEV_BACKEND_PORT:-8001}" --host 127.0.0.1 --factory --reload --no-access-log)
PIDS=()
if [[ -n "${PLANNER_AUTH_INSTANCE:-}" ]]; then
	UVICORN_ARGS+=(--root-path "/$PLANNER_AUTH_INSTANCE")
	python entra-id/app.py &
	BROKER_PID=$!
	PIDS+=("$BROKER_PID")
	echo "Development URL: ${PLANNER_AUTH_PUBLIC_URL%/auth/}/$PLANNER_AUTH_INSTANCE/"
fi

PLANNER_SECRET_KEY="$PLANNER_SECRET_KEY" \
	uvicorn planner:make_app "${UVICORN_ARGS[@]}" > >(tee logfile.log) 2>&1 &
UVICORN_PID=$!

./node_modules/.bin/vite &
VITE_PID=$!

PIDS+=("$UVICORN_PID" "$VITE_PID")
wait -n "${PIDS[@]}"
