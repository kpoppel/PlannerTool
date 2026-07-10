"""Helpers for plugin runtime configuration payloads.

The backend stores runtime-manageable plugin settings and performs only
lightweight sanity validation. Plugin-specific schema validation is
intentionally delegated to frontend-provided forms.
"""

from __future__ import annotations

from typing import Any, Callable


DEFAULT_SCHEMA_VERSION = 1


DependencyOrderValidator = Callable[[list[dict[str, Any]]], Any]


def default_plugin_runtime_config() -> dict[str, Any]:
    """Return the default empty runtime config payload."""
    return {
        'schema_version': DEFAULT_SCHEMA_VERSION,
        'plugins': [],
    }


def normalize_plugin_runtime_config(
    payload: Any,
    *,
    dependency_validator: DependencyOrderValidator | None = None,
) -> dict[str, Any]:
    """Validate and normalize plugin runtime config.

    Rules:
    - Accept only object payloads with ``plugins`` as a list.
    - Keep plugin order as received.
    - Ensure plugin IDs are unique and non-empty strings.
    - Keep ``custom_config`` keys as-is (dict only, no deep validation).
    - Ensure at most one plugin is activated.
    - Force ``activated=False`` whenever ``enabled=False``.
    """
    if payload is None:
        return default_plugin_runtime_config()
    if not isinstance(payload, dict):
        raise ValueError('plugins config content must be an object')

    schema_version = payload.get('schema_version', DEFAULT_SCHEMA_VERSION)
    if isinstance(schema_version, bool) or not isinstance(schema_version, (int, float)):
        raise ValueError('schema_version must be a number')
    schema_version = int(schema_version)

    plugins = payload.get('plugins', [])
    if plugins is None:
        plugins = []
    if not isinstance(plugins, list):
        raise ValueError('plugins must be an array')

    normalized_plugins: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for index, entry in enumerate(plugins):
        normalized = _normalize_plugin_entry(entry, index)
        plugin_id = normalized['id']
        if plugin_id in seen_ids:
            raise ValueError(f'duplicate plugin id: {plugin_id}')
        seen_ids.add(plugin_id)
        normalized_plugins.append(normalized)

    _ensure_single_activated(normalized_plugins)
    _run_dependency_validator(normalized_plugins, dependency_validator)

    return {
        'schema_version': schema_version,
        'plugins': normalized_plugins,
    }


def _normalize_plugin_entry(entry: Any, index: int) -> dict[str, Any]:
    if not isinstance(entry, dict):
        raise ValueError('each plugin entry must be an object')

    plugin_id = entry.get('id')
    if not isinstance(plugin_id, str) or not plugin_id.strip():
        raise ValueError('plugin id must be a non-empty string')

    enabled = bool(entry.get('enabled', True))
    activated = bool(entry.get('activated', False))
    if not enabled:
        activated = False

    order = entry.get('order', index)
    if isinstance(order, bool) or not isinstance(order, int):
        raise ValueError('plugin order must be an integer when provided')

    custom_config = entry.get('custom_config', {})
    if custom_config is None:
        custom_config = {}
    if not isinstance(custom_config, dict):
        raise ValueError('custom_config must be an object')

    return {
        'id': plugin_id.strip(),
        'enabled': enabled,
        'activated': activated,
        'order': order,
        'custom_config': dict(custom_config),
    }


def _ensure_single_activated(plugins: list[dict[str, Any]]) -> None:
    """Keep only the first active plugin in order; disable the rest."""
    active_seen = False
    for plugin in plugins:
        if not plugin.get('enabled', False):
            plugin['activated'] = False
            continue
        if plugin.get('activated', False) and not active_seen:
            active_seen = True
            continue
        plugin['activated'] = False


def _run_dependency_validator(
    plugins: list[dict[str, Any]],
    dependency_validator: DependencyOrderValidator | None,
) -> None:
    """Hook for dependency ordering validation against plugin metadata."""
    if dependency_validator is None:
        return
    validation_result = dependency_validator(plugins)
    if not validation_result:
        return
    if isinstance(validation_result, str):
        raise ValueError(validation_result)
    if isinstance(validation_result, (list, tuple)) and validation_result:
        raise ValueError(str(validation_result[0]))
    raise ValueError('invalid plugin dependency order')
