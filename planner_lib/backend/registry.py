"""BackendRegistry: the single source of truth for task-backend implementations.

Selection
---------
``server_config.task_backend_id`` selects exactly one task backend. The ADO
backend family additionally selects a class by ``ado_config.transport``
(live service, synthetic generator, fixture replay or static file). Settings of
an inactive backend remain persisted and are never reinterpreted.

Adding a backend
----------------
Implement a class with ``BACKEND_ID``, ``config_schema()`` and
``build_from_flags()``, list it in ``_backend_classes()`` and describe it in
``describe_backends()``.
"""
from __future__ import annotations

from typing import Any, Dict, List, Type

from planner_lib.backend.selection import (
    ADO_BACKEND_ID, ADO_TRANSPORTS, LOCAL_BACKEND_ID, ado_transport, task_backend_id,
)


def _ado_transport_classes() -> Dict[str, Type]:
    # Import lazily to keep startup cost minimal and avoid circular imports.
    from planner_lib.backend.static import StaticBackend
    from planner_lib.backend.mock import MockGeneratorBackend, MockFixtureBackend
    from planner_lib.backend.azure import AzureDevOpsBackend

    return {
        'live': AzureDevOpsBackend,
        'mock_generator': MockGeneratorBackend,
        'mock_fixture': MockFixtureBackend,
        'static': StaticBackend,
    }


def available_backend_ids() -> tuple:
    """Task backends this build can activate."""
    return (ADO_BACKEND_ID, LOCAL_BACKEND_ID)


def get_active_class(server_config: Dict[str, Any], ado_config: Dict[str, Any]) -> Type:
    """Return the backend class selected by persisted backend id and ADO transport."""
    backend_id = task_backend_id(server_config)
    if backend_id == LOCAL_BACKEND_ID:
        from planner_lib.backend.local import LocalTaskBackend

        return LocalTaskBackend
    return _ado_transport_classes()[ado_transport(ado_config)]


def backend_settings(server_config: Dict[str, Any], ado_config: Dict[str, Any]) -> Dict[str, Any]:
    """Merge generic server flags with backend settings; backend keys win."""
    return {**server_config['feature_flags'], **ado_config['feature_flags']}


def build_active_backend(
    server_config: Dict[str, Any], ado_config: Dict[str, Any], **services: Any,
) -> Any:
    """Construct the active backend (not wrapped in CachingBackend)."""
    cls = get_active_class(server_config, ado_config)
    return cls.build_from_flags(backend_settings(server_config, ado_config), **services)


def rebuild_backend_instance(
    instance: Any, server_config: Dict[str, Any], ado_config: Dict[str, Any], **services: Any,
) -> Any:
    """Rebuild *instance* in place for the currently selected backend."""
    if instance.BACKEND_ID != task_backend_id(server_config):
        raise ValueError('Changing task backend requires an application restart')
    replacement = build_active_backend(server_config, ado_config, **services)
    instance.__class__ = replacement.__class__
    instance.__dict__ = replacement.__dict__
    return instance


def describe_backends() -> List[Dict[str, Any]]:
    """Backend identity and display metadata for administration."""
    classes = _ado_transport_classes()
    available = available_backend_ids()
    return [{
        'id': ADO_BACKEND_ID,
        'label': 'Azure DevOps',
        'available': ADO_BACKEND_ID in available,
        'transports': list(ADO_TRANSPORTS),
        'capabilities': sorted(classes['live'].CAPABILITIES),
    }, {
        'id': LOCAL_BACKEND_ID,
        'label': 'Local (SQLite)',
        'available': LOCAL_BACKEND_ID in available,
        'transports': [],
        'capabilities': sorted(get_active_class({'task_backend_id': LOCAL_BACKEND_ID}, {}).CAPABILITIES),
    }]


def active_backend_info(server_config: Dict[str, Any], ado_config: Dict[str, Any]) -> Dict[str, Any]:
    """Backend-neutral identity and capabilities of the selected backend."""
    cls = get_active_class(server_config, ado_config)
    return {'id': cls.BACKEND_ID, 'capabilities': sorted(cls.CAPABILITIES)}


def active_backend_info(server_config: Dict[str, Any], ado_config: Dict[str, Any]) -> Dict[str, Any]:
    """Backend-neutral identity and capabilities of the selected backend."""
    cls = get_active_class(server_config, ado_config)
    return {'id': cls.BACKEND_ID, 'capabilities': sorted(cls.CAPABILITIES)}


def get_merged_schema() -> Dict[str, Any]:
    """Return merged ADO transport settings from every transport class.

    Generic server flags (``enable_cache``, ``enable_brotli_middleware``) live
    in the ``server_config`` schema instead.
    """
    merged: Dict[str, Any] = {}
    for cls in _ado_transport_classes().values():
        merged.update(cls.config_schema())
    return merged


def get_ado_schema() -> Dict[str, Any]:
    """Return the JSON Schema for the ``ado_config`` object."""
    return {
        'type': 'object',
        'title': 'Azure DevOps Configuration',
        'description': 'Settings specific to Azure DevOps connectivity and transport.',
        'properties': {
            'organization_url': {
                'type': 'string',
                'title': 'Azure DevOps Organization',
                'description': 'Organization name (slug) in Azure DevOps (e.g. "MyCompany")',
            },
            'transport': {
                'type': 'string',
                'title': 'Transport',
                'enum': list(ADO_TRANSPORTS),
                'default': 'live',
            },
            'feature_flags': {
                'type': 'object',
                'title': 'Transport Settings',
                'description': 'ADO transport-specific options.',
                'properties': get_merged_schema(),
                'additionalProperties': True,
            },
        },
        'required': ['organization_url', 'transport', 'feature_flags'],
    }
