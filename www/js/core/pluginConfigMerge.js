/**
 * pluginConfigMerge.js
 *
 * Merges static plugin technical metadata (from modules.config.json) with
 * admin-persisted runtime config (from /api/plugins/config).
 *
 * Merge policy
 * ─────────────
 * Technical fields always come from modules.config.json (source of truth):
 *   id, type, name, icon, version, description, mountPoint, dependencies, exclusive, persistent
 *
 * Runtime-managed fields come from the backend config when present:
 *   enabled, activateOnStartup, menuPosition, sequence (list position), custom_config
 *
 * Default strategy when a plugin is missing from runtime config:
 *   enabled  → uses the value from modules.config.json (metadata default)
 *   activateOnStartup → false  (never auto-activate a plugin with no saved state)
 *
 * Output ordering:
 *   1. Plugins that appear in the runtime config list are output in that order.
 *   2. Remaining metadata plugins (not in runtime config) are appended in their
 *      original modules.config.json order.
 *   This keeps admin-defined sequence authoritative while gracefully absorbing
 *   newly-added plugins that have not yet been configured.
 */

/**
 * @typedef {{
 *   id: string,
 *   type: 'hidden'|'tool'|'menu',
 *   icon: string,
 *   name: string,
 *   version: string,
 *   description: string,
 *   enabled: boolean,
 *   activateOnStartup: boolean,
 *   exclusive: boolean,
 *   mountPoint: string,
 *   dependencies: string[],
 *   menuPosition?: 'before-tools'|'after-tools',
 *   persistent?: boolean,
 *   custom_config?: unknown,
 * }} PluginModuleConfig
 * @typedef {{
 *   id: string,
 *   enabled: boolean,
 *   activateOnStartup: boolean,
 *   menuPosition?: 'before-tools'|'after-tools',
 *   custom_config?: unknown,
 * }} RuntimePluginConfig
 */

/**
 * Merge modules.config.json metadata with backend runtime plugin config.
 *
 * @param {{ modules: PluginModuleConfig[] }} modulesConfig - parsed modules.config.json
 * @param {RuntimePluginConfig[]|null|undefined} runtimeConfig - array from /api/plugins/config,
 *                                                              or null/undefined when unavailable
 * @returns {{ modules: PluginModuleConfig[] }} merged config ready for PluginManager.loadFromConfig()
 */
export function mergePluginConfig(modulesConfig, runtimeConfig) {
  const metaModules = modulesConfig.modules;
  const deprecatedRuntimeIds = new Set(['plugin-cost-v1']);

  // Index metadata by id for fast lookup (skip entries without id)
  const metaById = new Map();
  metaModules.forEach((m) => {
    if (m.id) metaById.set(m.id, m);
  });

  // Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.
  if (!Array.isArray(runtimeConfig) || runtimeConfig.length === 0) {
    // No runtime config — use metadata as-is (modules.config.json defaults apply)
    return modulesConfig;
  }

  const merged = [];
  const placed = new Set();

  // First pass: runtime order (authoritative sequence)
  for (const r of runtimeConfig) {
    if (!r.id) continue;
    const meta = metaById.get(r.id);
    if (!meta) {
      if (deprecatedRuntimeIds.has(r.id)) {
        continue;
      }
      // id in runtime but no matching metadata entry — skip with warning
      console.warn(`[pluginConfigMerge] Runtime config references unknown plugin id "${r.id}" — skipped`);
      continue;
    }
    merged.push(_buildMergedEntry(meta, r));
    placed.add(r.id);
  }

  // Second pass: metadata entries not covered by runtime config (appended in original order)
  for (const meta of metaModules) {
    if (!meta.id || placed.has(meta.id)) continue;
    merged.push(_buildMergedEntry(meta, null));
  }

  return { modules: merged };
}

/**
 * Build a single merged module entry.
 * Technical fields always from meta; runtime fields from runtime when available.
 *
 * @param {PluginModuleConfig} meta - entry from modules.config.json
 * @param {RuntimePluginConfig|null} runtime - matching entry from backend runtime config, or null
 * @returns {PluginModuleConfig}
 */
function _buildMergedEntry(meta, runtime) {
  const base = {
    // Technical fields — read-only, always from metadata
    id: meta.id,
    type: meta.type,
    name: meta.name,
    icon: meta.icon,
    version: meta.version,
    description: meta.description,
    mountPoint: meta.mountPoint,
    dependencies: meta.dependencies,
    exclusive: meta.exclusive,
    ...(meta.persistent !== undefined ? { persistent: meta.persistent } : {}),
    ...(meta.menuPosition !== undefined ? { menuPosition: meta.menuPosition } : {}),
  };

  if (runtime) {
    return {
      ...base,
      enabled: Boolean(runtime.enabled),
      // Default activateOnStartup to false when not present in runtime entry
      activateOnStartup: Boolean(runtime.activateOnStartup),
      ...(runtime.menuPosition !== undefined ? { menuPosition: runtime.menuPosition } : {}),
      ...(runtime.custom_config !== undefined ? { custom_config: runtime.custom_config } : {}),
    };
  }

  // No runtime entry: use metadata defaults, but never auto-activate
  return {
    ...base,
    enabled: Boolean(meta.enabled),
    activateOnStartup: false,
  };
}
