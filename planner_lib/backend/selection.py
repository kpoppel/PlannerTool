"""Persisted task-backend selection, independent of backend implementations.

``server_config.task_backend_id`` selects the one active task backend.
``ado_config.transport`` selects how the ADO backend reaches its data. Each
backend keeps its own configuration when it is not active.
"""
from __future__ import annotations

from typing import Any, Dict

ADO_BACKEND_ID = 'ado'
LOCAL_BACKEND_ID = 'local'
TASK_BACKEND_IDS = (ADO_BACKEND_ID, LOCAL_BACKEND_ID)

ADO_TRANSPORTS = ('live', 'mock_generator', 'mock_fixture', 'static')

# Retired revision-45 selector flags in registry priority order (first match wins).
LEGACY_TRANSPORT_FLAGS = (
    ('use_static_backend', 'static'),
    ('use_azure_mock_generator', 'mock_generator'),
    ('use_azure_mock', 'mock_fixture'),
)


def task_backend_id(server_config: Dict[str, Any]) -> str:
    backend_id = server_config['task_backend_id']
    if backend_id not in TASK_BACKEND_IDS:
        raise ValueError(f'Unknown task backend: {backend_id!r}')
    return backend_id


def ado_transport(ado_config: Dict[str, Any]) -> str:
    transport = ado_config['transport']
    if transport not in ADO_TRANSPORTS:
        raise ValueError(f'Unknown ADO transport: {transport!r}')
    return transport


def uses_live_ado(server_config: Dict[str, Any], ado_config: Dict[str, Any]) -> bool:
    return (task_backend_id(server_config) == ADO_BACKEND_ID
            and ado_transport(ado_config) == 'live')


def validate_selection(server_config: Dict[str, Any], ado_config: Dict[str, Any]) -> None:
    """Reject unknown selections and retired selector flags."""
    task_backend_id(server_config)
    ado_transport(ado_config)
    for config in (server_config, ado_config):
        if not isinstance(config.get('feature_flags'), dict):
            raise ValueError('Backend configuration requires feature_flags')
        retired = [flag for flag, _ in LEGACY_TRANSPORT_FLAGS if flag in config['feature_flags']]
        if retired:
            raise ValueError(f'Retired backend selector flags: {retired}')
