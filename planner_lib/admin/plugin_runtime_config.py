"""Helpers for plugin runtime configuration payloads.

The backend stores runtime-manageable plugin settings and performs only
lightweight sanity validation. Plugin-specific schema validation is
intentionally delegated to frontend-provided forms.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)

DEFAULT_SCHEMA_VERSION = 2


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

    schema_version = payload.get('schema_version')
    if type(schema_version) is not int or schema_version != DEFAULT_SCHEMA_VERSION:
        raise ValueError('plugins config requires schema_version 2; run scripts/migrate.py --apply')

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

    if 'activated' in entry or 'order' in entry:
        raise ValueError('legacy plugin settings require scripts/migrate.py --apply')

    enabled = bool(entry.get('enabled', True))
    activated = bool(entry.get('activateOnStartup', False))
    if not enabled:
        activated = False

    menu_position = entry.get('menuPosition')
    if menu_position is not None and menu_position not in ('before-tools', 'after-tools'):
        raise ValueError('menuPosition must be before-tools or after-tools')

    custom_config = entry.get('custom_config', {})
    if custom_config is None:
        custom_config = {}
    if not isinstance(custom_config, dict):
        raise ValueError('custom_config must be an object')

    return {
        'id': plugin_id.strip(),
        'enabled': enabled,
        'activateOnStartup': activated,
        **({'menuPosition': menu_position} if menu_position is not None else {}),
        'custom_config': dict(custom_config),
    }


def _ensure_single_activated(plugins: list[dict[str, Any]]) -> None:
    """Keep only the first active plugin in order; disable the rest.
    
    Logs when multiple plugins attempt activation so admins can see
    if an invalid configuration was attempted and corrected.
    """
    active_seen = False
    adjusted_plugins = []
    
    for plugin in plugins:
        if not plugin.get('enabled', False):
            if plugin.get('activateOnStartup', False):
                plugin['activateOnStartup'] = False
                adjusted_plugins.append(plugin['id'])
            continue
        if plugin.get('activateOnStartup', False) and not active_seen:
            active_seen = True
            continue
        if plugin.get('activateOnStartup', False):
            plugin['activateOnStartup'] = False
            adjusted_plugins.append(plugin['id'])
    
    if adjusted_plugins:
        logger.warning(
            'Multiple plugins attempted activation; keeping only first active. '
            'Deactivated: %s', ', '.join(adjusted_plugins)
        )


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
