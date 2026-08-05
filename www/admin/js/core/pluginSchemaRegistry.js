/**
 * Plugin Schema Registry (Admin version)
 * 
 * Lightweight registry that discovers and caches plugin configuration schemas
 * from the user app's plugin registry for admin UI rendering.
 * 
 * This is a simplified version that discovers schemas from the plugin registry
 * without requiring a full PluginManager instance.
 */

/**
 * Discover plugin configuration schemas from the user app's plugin registry.
 * 
 * @param {Object} pluginRegistry - Map or object of { pluginId: PluginClass, ... }
 * @returns {Promise<Object>} Schema map { pluginId: { schema, defaultConfig } }
 */
export async function discoverPluginSchemas(pluginRegistry) {
  const schemaMap = {};

  // Handle both Map and plain object forms
  const entries =
    pluginRegistry instanceof Map
      ? Array.from(pluginRegistry.entries())
      : Object.entries(pluginRegistry);

  for (const [pluginId, pluginClass] of entries) {
    // Check if plugin class provides schema (optional static method)
    if (typeof pluginClass?.getAdminConfigSchema === 'function') {
      try {
        const schema = await pluginClass.getAdminConfigSchema();
        const defaultConfig =
          typeof pluginClass?.getDefaultAdminConfig === 'function'
            ? await pluginClass.getDefaultAdminConfig()
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

/**
 * Check if plugin has a configurable schema (schema with properties).
 * Only plugins with non-empty schema.properties should show Config button.
 * 
 * @param {string} pluginId - plugin identifier
 * @param {Object} schemaMap - cached schema map
 * @returns {boolean} true if plugin has non-empty schema.properties
 */
export function hasConfigurableSchema(pluginId, schemaMap) {
  const schemaInfo = schemaMap[pluginId];
  if (!schemaInfo) return false;
  const schema = schemaInfo.schema || {};
  return schema.properties && Object.keys(schema.properties).length > 0;
}

export default {
  discoverPluginSchemas,
  getPluginSchema,
  hasPluginSchema,
  hasConfigurableSchema,
};
