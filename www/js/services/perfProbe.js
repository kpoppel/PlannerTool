import { featureFlags } from '../config.js';

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function isPerfEnabled() {
  if (featureFlags.serviceInstrumentation === true) return true;
  if (typeof window !== 'undefined' && window.__plannerPerf === true) return true;
  return false;
}

function emitProbe(payload) {
  if (!isPerfEnabled()) return;
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('planner:perf-probe', { detail: payload }));
    } catch (_err) {
      // Probe dispatch must never affect runtime behavior.
    }
  }
  console.info('[planner-perf]', payload);
}

export function startPerfProbe(name, details = {}) {
  if (!isPerfEnabled()) return null;
  return {
    name,
    details,
    startedAt: nowMs(),
    startedEpochMs: Date.now(),
  };
}

export function endPerfProbe(probe, details = {}) {
  if (!probe || !isPerfEnabled()) return;
  const durationMs = Math.round((nowMs() - probe.startedAt) * 100) / 100;
  emitProbe({
    name: probe.name,
    durationMs,
    timestamp: new Date(probe.startedEpochMs).toISOString(),
    ...probe.details,
    ...details,
  });
}
