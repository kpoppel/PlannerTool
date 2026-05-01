"""BackendRegistry: the single source of truth for all BackendPort implementations.

Responsibilities
----------------
* Maintain the ordered list of backend classes.  The first class whose
  ``FEATURE_FLAG`` feature-flag is True in ``feature_flags`` is selected;
  ``AzureDevOpsBackend`` (``FEATURE_FLAG = None``) is the implicit default.
* Provide ``get_active_class(feature_flags)`` — selects the active backend class.
* Provide ``build_active_backend(feature_flags, **services)`` — constructs the
  active backend instance via each class's ``build_from_flags()`` classmethod.
* Provide ``get_merged_schema()`` — merges each class's ``config_schema()``
  return value into a single dict that the admin ``schema.py`` injects into the
  system-config feature_flags properties.

Lifecycle for adding or removing a backend
-------------------------------------------
* **Add**: implement the class with ``FEATURE_FLAG``, ``config_schema()``, and
  ``build_from_flags()``; then insert it in ``_PRIORITY_ORDER`` below at the
  correct priority position.
* **Remove**: delete the entry from ``_PRIORITY_ORDER`` and remove the class.
  No other file needs to change.

Priority order
--------------
Listed in descending priority — first match wins.  ``AzureDevOpsBackend``
must always be last (its ``FEATURE_FLAG`` is ``None`` so it is the fallback
when no flag is set).
"""
from __future__ import annotations

from typing import Any, Dict, List, Type


# ---------------------------------------------------------------------------
# Priority-ordered list of (feature_flag, class_path) tuples.
# Use lazy import to avoid loading unused backend modules at startup.
# ---------------------------------------------------------------------------

def _priority_backends() -> List[Type]:
    """Return backend classes in feature-flag priority order (first match wins).

    This is the ONLY place that needs to change when adding or removing a backend.
    """
    # Import here (not at module level) to keep startup import cost minimal
    # and avoid circular-import issues with modules that import registry.
    from planner_lib.backend.static import StaticBackend
    from planner_lib.backend.mock import MockGeneratorBackend, MockFixtureBackend
    from planner_lib.backend.azure import AzureDevOpsBackend

    return [
        StaticBackend,         # use_static_backend
        MockGeneratorBackend,  # use_azure_mock_generator
        MockFixtureBackend,    # use_azure_mock
        AzureDevOpsBackend,    # default (FEATURE_FLAG = None)
    ]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_active_class(feature_flags: Dict[str, Any]) -> Type:
    """Return the backend class to instantiate for the given ``feature_flags``.

    Iterates ``_priority_backends()`` and returns the first class whose
    ``FEATURE_FLAG`` key is truthy in ``feature_flags``.  Falls back to
    ``AzureDevOpsBackend`` (the last entry, ``FEATURE_FLAG = None``) when no
    flag matches.
    """
    backends = _priority_backends()
    for cls in backends:
        flag = getattr(cls, 'FEATURE_FLAG', None)
        if flag is not None and bool(feature_flags.get(flag, False)):
            return cls
    # Fallback: the last registered class (AzureDevOpsBackend, FEATURE_FLAG=None)
    return backends[-1]


def build_active_backend(feature_flags: Dict[str, Any], **services: Any) -> Any:
    """Construct and return the active BackendPort instance.

    Parameters
    ----------
    feature_flags:
        The ``feature_flags`` dict from server_config.
    **services:
        Injected runtime services forwarded to ``build_from_flags()``:
        ``org_url``, ``storage``, ``team_repository``, ``capacity_service``.

    Returns the constructed backend instance (not wrapped in CachingBackend —
    that is the caller's responsibility).
    """
    cls = get_active_class(feature_flags)
    return cls.build_from_flags(feature_flags, **services)


def get_merged_schema() -> Dict[str, Any]:
    """Return merged ``config_schema()`` properties from all registered backends.

    The result is a flat dict of ADO feature_flags property entries (one per
    backend-specific flag).  Used by ``get_ado_schema()`` to build the
    ``ado_config.feature_flags`` sub-schema.

    Generic feature flags (``enable_cache``, ``enable_memory_cache``,
    ``enable_brotli_middleware``) are **not** included — they live in the
    static portion of the system schema (``server_config``).
    """
    merged: Dict[str, Any] = {}
    for cls in _priority_backends():
        schema_fragment = getattr(cls, 'config_schema', None)
        if callable(schema_fragment):
            merged.update(schema_fragment())
    return merged


def get_ado_schema() -> Dict[str, Any]:
    """Return the JSON Schema for the ``ado_config`` diskcache object.

    ``organization_url`` is a fixed top-level property.  ADO backend
    feature-flag sub-properties are collected from every registered
    backend's ``config_schema()`` and nested under ``feature_flags``.

    When a new backend (e.g. Jira) is registered via ``_priority_backends()``,
    its ``config_schema()`` properties automatically appear here.
    """
    feature_flag_props = get_merged_schema()
    return {
        'type': 'object',
        'title': 'Azure DevOps Configuration',
        'description': (
            'Settings specific to Azure DevOps connectivity and backend selection. '
            'Stored in diskcache and updated via the admin interface.'
        ),
        'properties': {
            'organization_url': {
                'type': 'string',
                'title': 'Azure DevOps Organization',
                'description': 'Organization name (slug) in Azure DevOps (e.g. "MyCompany")',
            },
            'feature_flags': {
                'type': 'object',
                'title': 'Backend Feature Flags',
                'description': 'Backend selection and ADO-specific options.',
                'properties': feature_flag_props,
                'additionalProperties': True,
            },
        },
    }
