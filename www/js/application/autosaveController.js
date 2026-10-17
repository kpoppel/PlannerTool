import { ConfigEvents } from '../core/EventRegistry.js';

export function createAutosaveController({
  bus,
  getChangedScenarioIds,
  getScenarioAccess,
  saveScenario,
  getLocalPref,
  notify,
}) {
  let timerId = null;
  let saveInProgress = false;

  function stopTimer() {
    if (timerId !== null) clearInterval(timerId);
    timerId = null;
  }

  async function saveChangedScenarios() {
    if (saveInProgress) return;
    saveInProgress = true;
    try {
      for (const scenarioId of getChangedScenarioIds()) {
        if (!getScenarioAccess(scenarioId).canEdit) continue;
        try {
          const result = await saveScenario(scenarioId);
          if (!result.ok) {
            reportSaveFailure(scenarioId, result);
          }
        } catch (error) {
          reportSaveFailure(scenarioId, error);
        }
      }
    } finally {
      saveInProgress = false;
    }
  }

  function reportSaveFailure(scenarioId, failure) {
    console.error('[Autosave] Scenario save failed', { scenarioId, failure });
    notify({
      source: 'Scenario autosave',
      code: 'autosave-failed',
      severity: 'error',
      message: 'Autosave failed. Your scenario changes remain unsaved; try Save from the Scenario menu.',
    });
  }

  function configureInterval(interval) {
    stopTimer();
    // Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.
    const minutes = Number(interval);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    timerId = setInterval(saveChangedScenarios, minutes * 60 * 1000);
  }

  const unsubscribe = bus.on(ConfigEvents.AUTOSAVE, ({ autosaveInterval }) => {
    configureInterval(autosaveInterval);
  });

  return {
    async start() {
      const interval = await getLocalPref('autosave.interval');
      configureInterval(interval);
    },
    stop() {
      stopTimer();
      unsubscribe();
    },
  };
}