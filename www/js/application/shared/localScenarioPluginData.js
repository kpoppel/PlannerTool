/**
 * localScenarioPluginData.js
 * Local-storage fallback for the `pluginData` bag of scenarios that have no
 * server-side scenario record (currently only the synthetic 'baseline'
 * scenario). Generic across plugins: stores the whole `pluginData` object for
 * a scenario id under one key, so no plugin-specific storage code is needed.
 */

function storageKey(scenarioId) {
  return `plannerTool_localPluginData_${scenarioId}`;
}

/**
 * @param {string} scenarioId
 * @returns {Record<string, any>}
 */
export function loadLocalPluginData(scenarioId) {
  try {
    const data = localStorage.getItem(storageKey(scenarioId));
    if (data) {
      const parsed = JSON.parse(data);
      if (parsed && Object.prototype.toString.call(parsed) === '[object Object]') return parsed;
    }
  } catch (e) {
    console.warn('[localScenarioPluginData] Failed to load pluginData:', e);
  }
  return {};
}

/**
 * @param {string} scenarioId
 * @param {Record<string, any>} pluginData
 */
export function saveLocalPluginData(scenarioId, pluginData) {
  try {
    localStorage.setItem(storageKey(scenarioId), JSON.stringify(pluginData));
  } catch (e) {
    console.warn('[localScenarioPluginData] Failed to save pluginData:', e);
  }
}
