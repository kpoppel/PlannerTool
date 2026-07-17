import { expect } from '@esm-bundle/chai';

import { AppStore } from '../../www/js/application/AppStore.js';
import { createInitialAppState } from '../../www/js/application/createInitialAppState.js';
import { createPlannerRuntimeServices } from '../../www/js/application/createPlannerRuntimeServices.js';
import { dataService } from '../../www/js/services/dataService.js';

const DEFAULT_ITERATIONS = 8;
const DEFAULT_WARMUP_RUNS = 1;

function nowMs() {
  return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
}

function countLabel(labels, target) {
  return labels.filter((label) => label === target).length;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseOptionalFloat(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function pushDuration(map, key, duration) {
  if (!Number.isFinite(duration)) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(duration);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rawIndex = (sorted.length - 1) * p;
  const low = Math.floor(rawIndex);
  const high = Math.ceil(rawIndex);
  if (low === high) return sorted[low];
  const ratio = rawIndex - low;
  return sorted[low] + (sorted[high] - sorted[low]) * ratio;
}

function summarize(values) {
  if (!values.length) {
    return {
      count: 0,
      total: 0,
      avg: 0,
      p50: 0,
      p95: 0,
      min: 0,
      max: 0,
    };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    total: round3(total),
    avg: round3(total / values.length),
    p50: round3(percentile(values, 0.5)),
    p95: round3(percentile(values, 0.95)),
    min: round3(Math.min(...values)),
    max: round3(Math.max(...values)),
  };
}

function wrapTimedMethod(target, methodName, onDuration) {
  if (!target || typeof target[methodName] !== 'function') {
    return () => {};
  }
  const original = target[methodName];
  target[methodName] = function wrappedTimedMethod(...args) {
    const started = nowMs();
    const finish = () => onDuration(nowMs() - started);
    try {
      const result = original.apply(this, args);
      if (result && typeof result.then === 'function') {
        return result.finally(finish);
      }
      finish();
      return result;
    } catch (error) {
      finish();
      throw error;
    }
  };
  return () => {
    target[methodName] = original;
  };
}

function buildClusterDurations(iteration) {
  const labels = iteration.updateDurations;
  const phases = iteration.phaseDurations;
  const sumLabels = (targets) =>
    targets.reduce((sum, label) => sum + (labels.get(label) || []).reduce((a, b) => a + b, 0), 0);
  const sumPhase = (phase) => (phases.get(phase) || []).reduce((sum, value) => sum + value, 0);

  return {
    cluster1Init: sumPhase('replaceBaselineAndEnsureScenario'),
    cluster2RestoreTransaction: sumPhase('applyViewRestoreTransaction'),
    cluster2BatchEnd: sumPhase('endViewRestoreBatch'),
    cluster2CapacityUpdate: sumLabels(['capacity.recompute.runtime']),
    cluster2RestoreUpdate: sumLabels(['view.restore.transaction.runtime']),
    clusterTotalUpdateTime:
      sumLabels(['baseline.ensureScenario.runtime', 'view.restore.transaction.runtime', 'capacity.recompute.runtime']),
  };
}

describe('startup restore performance loop (offline)', () => {
  let originalListViews;
  let originalGetView;

  beforeEach(() => {
    originalListViews = dataService.listViews;
    originalGetView = dataService.getView;
  });

  afterEach(() => {
    dataService.listViews = originalListViews;
    dataService.getView = originalGetView;
  });

  it('produces repeatable startup cluster timing for regression analysis', async () => {
    const startupViewId = 'startup-view';
    const iterations = parsePositiveInt(process.env.STARTUP_PERF_ITERATIONS, DEFAULT_ITERATIONS);
    const warmupRuns = Math.min(
      parseNonNegativeInt(process.env.STARTUP_PERF_WARMUP, DEFAULT_WARMUP_RUNS),
      Math.max(0, iterations - 1)
    );
    const maxTotalP95 = parseOptionalFloat(process.env.STARTUP_PERF_MAX_TOTAL_P95_MS);
    const maxCluster2P95 = parseOptionalFloat(process.env.STARTUP_PERF_MAX_CLUSTER2_P95_MS);

    dataService.listViews = async () => [
      {
        id: startupViewId,
        name: 'Startup View',
        readonly: false,
      },
    ];

    dataService.getView = async (viewId) => {
      if (viewId !== startupViewId) return null;
      return {
        id: startupViewId,
        name: 'Startup View',
        readonly: false,
        selectedProjects: { p1: true },
        selectedTeams: { t1: true },
        viewOptions: {
          graphType: 'team',
          expandParentChild: false,
          expandRelations: false,
          expandTeamAllocated: false,
          selectedFeatureStates: ['New'],
          taskFilters: {
            schedule: { planned: true, unplanned: true },
            allocation: { allocated: true, unallocated: true },
            hierarchy: { hasParent: true, noParent: true },
            relations: { hasLinks: true, noLinks: true },
          },
        },
      };
    };

    const allIterations = [];

    for (let i = 0; i < iterations; i += 1) {
      const store = new AppStore(createInitialAppState());
      const updateLabels = [];
      const updateDurations = new Map();
      const phaseDurations = new Map();

      const originalUpdate = store.update.bind(store);
      store.update = (label, reducer) => {
        const started = nowMs();
        const changed = originalUpdate(label, reducer);
        pushDuration(updateDurations, label, nowMs() - started);
        return changed;
      };

      const unsubscribe = store.subscribe(
        (state) => state,
        (_state, _prev, change) => {
          updateLabels.push(change.label);
        }
      );

      const runtimeServices = createPlannerRuntimeServices({
        eventBus: {
          emit: () => {},
          on: () => () => {},
        },
        store,
        adapters: {
          viewManagement: {
            storage: {
              getItem: () => startupViewId,
              setItem: () => {},
            },
          },
        },
        dataService: {
          init: async () => {},
          getProjects: async () => [
            {
              id: 'p1',
              name: 'Project 1',
              display_states: ['New'],
              state_categories: { New: 'active' },
            },
          ],
          getTeams: async () => [
            {
              id: 't1',
              name: 'Team 1',
              projectId: 'p1',
            },
          ],
          getFeatures: async () => [
            {
              id: 'f1',
              title: 'Feature 1',
              projectId: 'p1',
              teamId: 't1',
              state: 'New',
              workItems: [],
            },
          ],
          getIterations: async () => ({ p1: [] }),
          loadAllScenarios: async () => [],
          getColorMappings: async () => ({ projectColors: {}, teamColors: {} }),
          getLocalPref: async () => null,
          setLocalPref: async () => {},
          saveScenario: async () => ({ ok: true }),
        },
      });

      const { runtime } = runtimeServices;
      const restoreWrap = wrapTimedMethod(runtime, 'applyViewRestoreTransaction', (ms) =>
        pushDuration(phaseDurations, 'applyViewRestoreTransaction', ms)
      );
      const batchWrap = wrapTimedMethod(runtime, 'endViewRestoreBatch', (ms) =>
        pushDuration(phaseDurations, 'endViewRestoreBatch', ms)
      );
      const baselineWrap = wrapTimedMethod(runtime, 'replaceBaselineAndEnsureScenario', (ms) =>
        pushDuration(phaseDurations, 'replaceBaselineAndEnsureScenario', ms)
      );

      const started = nowMs();
      await runtime.initialize();
      const totalStartupMs = nowMs() - started;

      expect(store.getState().view.activeId).to.equal(startupViewId);
      expect(countLabel(updateLabels, 'baseline.ensureScenario.runtime')).to.equal(1);
      expect(countLabel(updateLabels, 'view.restore.transaction.runtime')).to.equal(1);
      expect(countLabel(updateLabels, 'view.replace.runtime')).to.equal(0);
      expect(countLabel(updateLabels, 'capacity.recompute.runtime')).to.equal(0);

      allIterations.push({
        totalStartupMs,
        updateLabels,
        updateDurations,
        phaseDurations,
      });

      restoreWrap();
      batchWrap();
      baselineWrap();
      unsubscribe();
      await runtime.destroy();
    }

    const measuredIterations = allIterations.slice(warmupRuns);
    const totalMs = measuredIterations.map((iteration) => iteration.totalStartupMs);
    const labelBuckets = new Map();
    const phaseBuckets = new Map();
    const clusterBuckets = new Map();

    for (const iteration of measuredIterations) {
      for (const [label, durations] of iteration.updateDurations.entries()) {
        durations.forEach((duration) => pushDuration(labelBuckets, label, duration));
      }
      for (const [phase, durations] of iteration.phaseDurations.entries()) {
        durations.forEach((duration) => pushDuration(phaseBuckets, phase, duration));
      }

      const clusterDurations = buildClusterDurations(iteration);
      Object.entries(clusterDurations).forEach(([cluster, duration]) => {
        pushDuration(clusterBuckets, cluster, duration);
      });
    }

    const summarizeMap = (map) =>
      Object.fromEntries(
        [...map.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, values]) => [key, summarize(values)])
      );

    const report = {
      iterations,
      warmupRuns,
      measuredIterations: measuredIterations.length,
      totals: summarize(totalMs),
      labels: summarizeMap(labelBuckets),
      phases: summarizeMap(phaseBuckets),
      clusters: summarizeMap(clusterBuckets),
      clusterDefinition: {
        cluster1Init: ['replaceBaselineAndEnsureScenario'],
        cluster2RestoreTransaction: ['applyViewRestoreTransaction'],
        cluster2BatchEnd: ['endViewRestoreBatch'],
        cluster2CapacityUpdate: ['capacity.recompute.runtime'],
        cluster2RestoreUpdate: ['view.restore.transaction.runtime'],
      },
    };

    // Machine-readable payload for local profiling loops and baseline comparisons.
    console.info(`STARTUP_PERF_REPORT ${JSON.stringify(report)}`);

    if (maxTotalP95 !== null) {
      expect(report.totals.p95).to.be.at.most(maxTotalP95);
    }
    if (maxCluster2P95 !== null) {
      expect(report.clusters.cluster2RestoreTransaction?.p95 || 0).to.be.at.most(maxCluster2P95);
    }
  });
});
