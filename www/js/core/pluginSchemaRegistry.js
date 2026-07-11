/**
 * Plugin Schema Registry
 * 
 * Lightweight registry that discovers and caches plugin configuration schemas.
 * Plugins provide schema metadata through static or instance methods without
 * requiring heavy component instantiation.
 * 
 * Intent:
 * - Map plugin id → schema and default config provider
 * - Keep registry lightweight (lazy-load, no instantiation)
 * - Support plugins without custom config (backward compatible)
 * 
 * Schema contract:
 * - Plugin class exposes static method: static getAdminConfigSchema()
 * - Plugin class exposes static method: static getDefaultAdminConfig()
 * - Both methods are optional; absence indicates plugin has no custom config
 */

/**
 * Discover and cache plugin configuration schemas.
 * 
 * @param {Map<string, Plugin>} pluginManager.plugins - Map of registered plugins
 * @returns {Promise<Object>} Schema map { pluginId: { schema, defaultConfig } }
 */
export async function discoverPluginSchemas(pluginManager) {
  const schemaMap = {};

  for (const [pluginId, pluginInstance] of pluginManager.plugins) {
    // Try to find schema provider on the plugin instance or its constructor
    const ctor = pluginInstance.constructor;

    // Check if plugin class provides schema (optional)
    if (typeof ctor.getAdminConfigSchema === 'function') {
      try {
        const schema = await ctor.getAdminConfigSchema();
        const defaultConfig =
          typeof ctor.getDefaultAdminConfig === 'function'
            ? await ctor.getDefaultAdminConfig()
            : {};

        if (schema) {
          schemaMap[pluginId] = {
            schema,
            defaultConfig: defaultConfig || {},
          };
        }
      } catch (err) {
        console.warn(
          `Failed to load schema for plugin ${pluginId}:`,
          err
        );
      }
    }
  }

  return schemaMap;
}

/**
 * Get schema for a specific plugin.
 * 
 * @param {string} pluginId - plugin identifier
 * @param {Object} schemaMap - cached schema map from discoverPluginSchemas
 * @returns {Object|null} { schema, defaultConfig } or null if no schema
 */
export function getPluginSchema(pluginId, schemaMap) {
  return schemaMap[pluginId] || null;
}

/**
 * Check if plugin has custom configuration schema.
 * 
 * @param {string} pluginId - plugin identifier
 * @param {Object} schemaMap - cached schema map
 * @returns {boolean} true if plugin has schema
 */
export function hasPluginSchema(pluginId, schemaMap) {
  return !!schemaMap[pluginId];
}

export default {
  discoverPluginSchemas,
  getPluginSchema,
  hasPluginSchema,
};
