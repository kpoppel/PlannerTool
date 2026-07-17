#!/usr/bin/env bash
set -euo pipefail

BASE_URL=""
SESSION_ID=""
RUNS=5

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="$2"
      shift 2
      ;;
    --session-id)
      SESSION_ID="$2"
      shift 2
      ;;
    --runs)
      RUNS="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$BASE_URL" || -z "$SESSION_ID" ]]; then
  echo "Usage: $0 --base-url <url> --session-id <sid> [--runs <n>]" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

measure_endpoint() {
  local endpoint="$1"
  local label="$2"
  local metrics_file="$TMP_DIR/${label}_metrics.tsv"

  : > "$metrics_file"

  echo ""
  echo "=== ${label} (${endpoint}) ==="

  for i in $(seq 1 "$RUNS"); do
    local hdr="$TMP_DIR/${label}_${i}.headers"
    local body="$TMP_DIR/${label}_${i}.body"

    local result
    result="$(curl -sS \
      -H "X-Session-Id: ${SESSION_ID}" \
      -H "X-Perf-Probe: 1" \
      -H "Accept-Encoding: gzip, br" \
      -D "$hdr" \
      -o "$body" \
      -w "%{time_starttransfer}\t%{time_total}\t%{size_download}\n" \
      "${BASE_URL}${endpoint}")"

    local ttfb total size
    ttfb="$(echo "$result" | awk -F'\t' '{print $1}')"
    total="$(echo "$result" | awk -F'\t' '{print $2}')"
    size="$(echo "$result" | awk -F'\t' '{print $3}')"

    local server_timing
    server_timing="$(grep -i '^Server-Timing:' "$hdr" | sed 's/[Ss]erver-[Tt]iming:[[:space:]]*//' | tr -d '\r' || true)"

    printf "%s\t%s\t%s\n" "$ttfb" "$total" "$size" >> "$metrics_file"

    echo "run=${i} ttfb=${ttfb}s total=${total}s bytes=${size} server_timing=${server_timing:-n/a}"
  done

  local count
  count="$(wc -l < "$metrics_file" | tr -d ' ')"
  if [[ "$count" -eq 0 ]]; then
    echo "No measurements captured for ${label}" >&2
    return
  fi

  local p50_idx p95_idx
  p50_idx=$(( (count + 1) / 2 ))
  p95_idx=$(( (count * 95 + 99) / 100 ))
  if [[ "$p95_idx" -lt 1 ]]; then p95_idx=1; fi
  if [[ "$p95_idx" -gt "$count" ]]; then p95_idx="$count"; fi

  local ttfb_p50 ttfb_p95 total_p50 total_p95 size_max
  ttfb_p50="$(awk -F'\t' '{print $1}' "$metrics_file" | sort -n | sed -n "${p50_idx}p")"
  ttfb_p95="$(awk -F'\t' '{print $1}' "$metrics_file" | sort -n | sed -n "${p95_idx}p")"
  total_p50="$(awk -F'\t' '{print $2}' "$metrics_file" | sort -n | sed -n "${p50_idx}p")"
  total_p95="$(awk -F'\t' '{print $2}' "$metrics_file" | sort -n | sed -n "${p95_idx}p")"
  size_max="$(awk -F'\t' 'BEGIN{m=0} {if($3>m)m=$3} END{print m}' "$metrics_file")"

  echo "summary runs=${count} ttfb_p50=${ttfb_p50}s ttfb_p95=${ttfb_p95}s total_p50=${total_p50}s total_p95=${total_p95}s max_bytes=${size_max}"
}

measure_endpoint "/api/tasks?perf=1" "tasks"
measure_endpoint "/api/iterations?perf=1" "iterations"
