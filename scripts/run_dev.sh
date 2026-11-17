#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
	printf '%s\n' \
		'Usage: scripts/run_dev.sh [--auth-env /absolute/path/to/protected.env] [--check]' \
		'Without --auth-env: ordinary PAT/enrollment development.' \
		'--check validates local prerequisites and broker configuration without starting services.' \
		'Entra certificate (recommended): ENTRA_CLIENT_CERTIFICATE_FILE and ENTRA_CLIENT_CERTIFICATE_KEY_FILE.' \
		'Entra app secret: ENTRA_CLIENT_SECRET_FILE instead of both certificate fields.' \
		'Mock: a dummy ENTRA_CLIENT_SECRET_FILE; never production credentials.' \
		'Use protected mode-0600 files. Never configure both credential methods.' \
		'Setup, key generation and registration: docs/DEPLOYMENT.md'
}

fail() {
	printf 'ERROR: %s\n' "$*" >&2
	exit 1
}

AUTH_ENV=''
CHECK_ONLY=false
while [[ $# -gt 0 ]]; do
	case "$1" in
		--help|-h) usage; exit 0 ;;
		--check) CHECK_ONLY=true; shift ;;
		--auth-env)
			[[ $# -ge 2 && -n "$2" && "$2" != --* && -z "$AUTH_ENV" ]] || {
				usage >&2
				exit 1
			}
			AUTH_ENV="$2"
			shift 2
			;;
		*) usage >&2; exit 1 ;;
	esac
done

if [[ -n "$AUTH_ENV" ]]; then
	if [[ ! -f "$AUTH_ENV" ]]; then
		fail 'Authentication env file does not exist. See docs/DEPLOYMENT.md.'
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

PYTHON="$ROOT_DIR/.venv/bin/python"
[[ -x "$PYTHON" ]] || fail 'Missing project .venv. Run scripts/setup-dev.sh; see docs/DEPLOYMENT.md.'
if ! "$PYTHON" -c 'import uvicorn' >/dev/null 2>&1; then
	fail 'Install server dependencies in .venv: .venv/bin/python -m pip install -r requirements.txt'
fi
[[ -x ./node_modules/.bin/vite ]] || fail 'Missing Vite dependencies. Run npm install.'
[[ -r .encryption_key && -s .encryption_key ]] || \
	fail 'Missing or empty .encryption_key. Restore the original key for existing data; see docs/DEPLOYMENT.md.'

PLANNER_SECRET_KEY="$(cat .encryption_key)"

if [[ -n "${PLANNER_AUTH_INSTANCE:-}" ]]; then
	if ! "$PYTHON" -c 'import msal, fastapi, cryptography, httpx, requests' >/dev/null 2>&1; then
		fail 'Install broker dependencies in .venv: .venv/bin/python -m pip install -r entra-id/requirements.txt'
	fi
	"$PYTHON" entra-id/app.py --check
else
	echo 'Authentication: PAT/enrollment (no Entra broker).'
fi
if [[ "$CHECK_ONLY" == true ]]; then
	echo 'Local configuration check passed; no services started. This does not verify Microsoft consent or connectivity.'
	exit 0
fi

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
	"$PYTHON" entra-id/app.py &
	BROKER_PID=$!
	PIDS+=("$BROKER_PID")
	echo "Development URL: ${PLANNER_AUTH_PUBLIC_URL%/auth/}/$PLANNER_AUTH_INSTANCE/"
fi

PLANNER_SECRET_KEY="$PLANNER_SECRET_KEY" \
	"$PYTHON" -m uvicorn planner:make_app "${UVICORN_ARGS[@]}" > >(tee logfile.log) 2>&1 &
UVICORN_PID=$!

./node_modules/.bin/vite &
VITE_PID=$!

PIDS+=("$UVICORN_PID" "$VITE_PID")
wait -n "${PIDS[@]}"
