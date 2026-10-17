"""Static JSON Schema definitions for PlannerTool configuration types.

Extracted from ``admin/api.py`` so the route handler only does thin HTTP
glue and schema selection.

Public API:
- ``get_schema(config_type)`` — return the JSON Schema dict for a config type
  or ``None`` when the type is unknown.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Static schema registry
# ---------------------------------------------------------------------------

_SCHEMAS: dict[str, Any] = {
    'ado_processes': {
        'type': 'object', 'title': 'Azure DevOps Processes', 'additionalProperties': False,
        'required': ['schema_version', 'processes'],
        'properties': {
            'schema_version': {'type': 'integer', 'const': 1},
            'processes': {'type': 'array', 'items': {
                'type': 'object', 'additionalProperties': False,
                'required': ['id', 'name', 'projects', 'loaded_at', 'types'],
                'properties': {
                    'id': {'type': 'string', 'minLength': 1},
                    'name': {'type': 'string', 'minLength': 1},
                    'parent_name': {'type': 'string'},
                    'projects': {'type': 'array', 'items': {'type': 'string'}, 'uniqueItems': True},
                    'loaded_at': {'type': 'string'},
                    'types': {'type': 'array', 'items': {
                        'type': 'object', 'additionalProperties': False,
                        'required': ['reference_name', 'name', 'backlog_level', 'backlog',
                                     'imported', 'missing', 'states'],
                        'properties': {
                            'reference_name': {'type': 'string'}, 'name': {'type': 'string'},
                            'backlog_level': {'enum': ['portfolio', 'requirement', 'task', 'none']},
                            'backlog': {'type': ['string', 'null']},
                            'imported': {'type': 'boolean'}, 'missing': {'type': 'boolean'},
                            'states': {'type': 'array', 'items': {
                                'type': 'object', 'additionalProperties': False,
                                'required': ['name', 'category', 'order'],
                                'properties': {
                                    'name': {'type': 'string'},
                                    'category': {'enum': ['Proposed', 'InProgress', 'Resolved', 'Completed', 'Removed']},
                                    'order': {'type': 'integer'},
                                },
                            }},
                        },
                    }},
                },
            }},
        },
    },
    'system': {
        'type': 'object',
        'title': 'Server Configuration',
        'description': 'Generic server settings and feature flags.  ADO-specific settings are in the Azure DevOps section.',
        'properties': {
            'server_name': {
                'type': 'string',
                'title': 'Server Name',
                'description': 'Unique identifier for this server instance',
                'minLength': 1,
            },
            'log_level': {
                'type': 'string',
                'title': 'Log Level',
                'description': 'Logging verbosity level',
                'enum': ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'],
                'default': 'INFO',
            },
            'feature_flags': {
                'type': 'object',
                'title': 'Feature Flags',
                'description': 'Toggle generic server features.  ADO backend flags live in the Azure DevOps section.',
                'properties': {
                    'enable_cache': {
                        'type': 'boolean',
                        'title': 'Enable Cache',
                        'description': 'Cache backend responses (works with all backend types)',
                        'default': True,
                    },
                    'enable_brotli_middleware': {
                        'type': 'boolean',
                        'title': 'Enable Brotli Compression',
                        'description': 'Compress HTTP responses with Brotli',
                        'default': True,
                    },
                    'stand_alone_mode': {
                        'type': 'boolean',
                        'title': 'Stand-alone Mode',
                        'description': 'Reserved for future use — enables fully offline operation without any backend connectivity',
                        'default': False,
                    },
                    'manage_backup_snapshots': {
                        'type': 'boolean',
                        'title': 'Manage Backup Snapshots',
                        'description': 'Enable the backup snapshot manager in the admin UI (list, prune, delete, restore individual config backups)',
                        'default': False,
                    },
                },
                'additionalProperties': True,
            },
            # cache.ttls are managed from the Data Sources admin panel
            # (each domain row owns its own TTL setting). The 'cache' object
            # is still written back by that panel but is no longer surfaced
            # in the Server schema.
        },
        'required': ['server_name'],
    },
    'projects': {
        'type': 'object',
        'title': 'Project Configuration',
        'description': 'Plan hierarchy and canonical workforce availability (schema v4)',
        'properties': {
            'schema_version': {
                'type': 'integer',
                'title': 'Schema Version',
                'description': 'Configuration schema version',
                'default': 4,
                'const': 4,
            },
            'container_types': {
                'type': 'array',
                'title': 'Plan Container Hierarchy',
                'description': 'Unique container types in top-to-bottom order',
                'items': {'type': 'string', 'minLength': 1},
                'uniqueItems': True,
                'minItems': 1,
                'default': ['project', 'team'],
            },
            'allocation_defaults': {
                'type': 'object', 'title': 'Allocation Defaults By Container Type',
                'additionalProperties': {
                    'type': 'array', 'items': {'type': 'string', 'minLength': 1},
                    'uniqueItems': True,
                },
            },
            'project_map': {
                'type': 'array',
                'title': 'Project Mappings',
                'items': {
                    'type': 'object',
                    'additionalProperties': False,
                    'properties': {
                        'id': {
                            'type': 'string',
                            'title': 'Project ID',
                            'description': 'Persistent unique identity. Do not change after creation.',
                            'format': 'uuid',
                            'readOnly': True,
                        },
                        'allocatable_ids': {
                            'type': 'array', 'title': 'Allocation Override',
                            'items': {'type': 'string', 'minLength': 1},
                            'uniqueItems': True,
                        },
                        'name': {
                            'type': 'string',
                            'title': 'Project Name',
                            'minLength': 1,
                        },
                        'archived': {
                            'type': 'boolean',
                            'title': 'Archived',
                            'description': 'Keep this project configured but unavailable to users.',
                            'default': False,
                        },
                        'area_path': {
                            'type': 'string',
                            'title': 'Area Path',
                            'description': 'Azure DevOps area path (e.g., Project\\\\Team)',
                            'minLength': 1,
                        },
                        'type': {
                            'type': 'string',
                            'title': 'Type',
                        },
                        'task_types': {
                            'type': 'array',
                            'title': 'Work Item Types',
                            'description': 'Types of work items to include',
                            'items': {'type': 'string'},
                            'minItems': 1,
                        },
                        'closed_history_days': {
                            'type': 'integer', 'title': 'Closed work history',
                            'minimum': 0, 'default': 0,
                        },
                        'iteration_uuid': {
                            'type': ['string', 'null'],
                            'title': 'Iteration Set',
                            'description': 'Optional iteration set ID from iterations configuration.',
                        },
                    },
                    'required': ['name', 'area_path', 'type', 'task_types', 'closed_history_days'],
                },
            },
        },
        'required': ['schema_version', 'container_types', 'allocation_defaults', 'project_map'],
    },
    'area_mappings': {
        'type': 'object',
        'title': 'Area to Plan Mappings',
        'description': 'Map Azure DevOps area paths to delivery plans',
        'additionalProperties': {
            'type': 'object',
            'properties': {
                'areas': {
                    'type': 'object',
                    'additionalProperties': {
                        'type': 'object',
                        'properties': {
                            'plans': {'type': 'array', 'items': {'type': 'string'}},
                            'last_update': {'type': 'string', 'format': 'date-time'},
                        },
                    },
                },
                'last_update': {'type': 'string', 'format': 'date-time'},
            },
        },
    },
    'events_config': {
        'type': 'object',
        'title': 'Event Backend Configuration',
        'description': (
            'Selects the storage backend for plan events. '
            'Use "local" (default) to persist events in the PlannerTool diskcache database. '
            'Use "ado_wiki" to persist events as a structured page in an Azure DevOps wiki — '
            'events are then visible and linkable directly in ADO.'
        ),
        'properties': {
            'event_backend': {
                'type': 'string',
                'title': 'Event Backend',
                'description': 'Storage backend for plan events.',
                'enum': ['local', 'ado_wiki'],
                'enumNames': [
                    'Local (PlannerTool database)',
                    'Azure DevOps Wiki page',
                ],
                'default': 'local',
            },
            'ado_wiki': {
                'type': 'object',
                'title': 'Azure DevOps Wiki Settings',
                'description': 'Required when event_backend is "ado_wiki".',
                'properties': {
                    'organization_url': {
                        'type': 'string',
                        'title': 'Organization Name',
                        'description': (
                            'Azure DevOps organization name (e.g. "MyCompany"). '
                            'This is usually the same as the task ADO backend but can be a different organization.'
                        ),
                        'minLength': 1,
                    },
                    'project': {
                        'type': 'string',
                        'title': 'ADO Project',
                        'description': 'Azure DevOps project name or GUID that owns the wiki.',
                        'minLength': 1,
                    },
                    'wiki_id': {
                        'type': 'string',
                        'title': 'Wiki ID',
                        'description': (
                            'Wiki identifier — typically "<ProjectName>.wiki" '
                            'for the project wiki, or the wiki GUID.'
                        ),
                        'minLength': 1,
                    },
                    'page_path': {
                        'type': 'string',
                        'title': 'Page Path',
                        'description': (
                            'Path to the wiki page that stores events, '
                            'e.g. "/PlannerTool/Events".  The page is '
                            'created automatically on first write.'
                        ),
                        'default': '/PlannerTool/Events',
                        'minLength': 1,
                    },
                },
                'required': ['organization_url', 'project', 'wiki_id', 'page_path'],
            },
        },
    },
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_schema(config_type: str) -> Optional[dict]:
    """Return a *copy* of the JSON Schema dict for *config_type*, or ``None``.

    ``'ado'`` is built dynamically from the BackendRegistry so future backends
    automatically appear in the Azure DevOps admin section.
    """
    import copy
    if config_type == 'ado':
        try:
            from planner_lib.backend.registry import get_ado_schema
            return get_ado_schema()
        except Exception:
            logger.warning('Failed to build ado schema from BackendRegistry', exc_info=True)
            return None
    if config_type == 'events_config' or config_type == 'eventsConfig':
        schema = _SCHEMAS.get('events_config')
        if schema is None:
            return None
        return copy.deepcopy(schema)
    if config_type == 'system':
        # system schema is static — backend flags no longer injected here;
        # they now live in the 'ado' schema.
        schema = _SCHEMAS.get('system')
        if schema is None:
            return None
        return copy.deepcopy(schema)
    schema = _SCHEMAS.get(config_type)
    if schema is None:
        return None
    return copy.deepcopy(schema)
