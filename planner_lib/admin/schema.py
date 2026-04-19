"""Static JSON Schema definitions for PlannerTool configuration types.

Extracted from ``admin/api.py`` so the route handler only does thin HTTP
glue and schema selection.

Public API:
- ``get_schema(config_type)`` — return the JSON Schema dict for a config type
  or ``None`` when the type is unknown.
- ``enrich_projects_schema(schema, azure_client, pat, admin_svc)`` — optionally
  decorates the ``projects`` schema with work-item types/states fetched live
  from Azure DevOps.  Silently no-ops when Azure is unreachable.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Static schema registry
# ---------------------------------------------------------------------------

_SCHEMAS: dict[str, Any] = {
    'system': {
        'type': 'object',
        'title': 'Server Configuration',
        'description': 'Core server settings and feature flags',
        'properties': {
            'server_name': {
                'type': 'string',
                'title': 'Server Name',
                'description': 'Unique identifier for this server instance',
                'minLength': 1,
            },
            'azure_devops_organization': {
                'type': 'string',
                'title': 'Azure DevOps Organization',
                'description': 'Organization name in Azure DevOps',
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
                'description': 'Toggle experimental or optional features',
                'properties': {
                    'enable_azure_cache': {
                        'type': 'boolean',
                        'title': 'Enable Azure Cache',
                        'description': 'Cache Azure DevOps API responses',
                        'default': True,
                    },
                    'enable_memory_cache': {
                        'type': 'boolean',
                        'title': 'Enable Memory Cache',
                        'description': 'Enable hot in-memory cache layer on top of the file-storage cache',
                        'default': False,
                    },
                    'enable_brotli_middleware': {
                        'type': 'boolean',
                        'title': 'Enable Brotli Compression',
                        'description': 'Compress HTTP responses with Brotli',
                        'default': True,
                    },
                    'use_azure_mock': {
                        'type': 'boolean',
                        'title': 'Use Azure Fixture Mock',
                        'description': 'Replay pre-recorded Azure DevOps SDK responses from disk instead of calling the live API',
                        'default': False,
                    },
                    'azure_mock_data_dir': {
                        'type': 'string',
                        'title': 'Fixture Mock Data Directory',
                        'description': 'Path to the directory containing recorded fixture files (used when use_azure_mock is true)',
                        'default': 'data/azure_mock',
                        'x-showWhen': 'use_azure_mock',
                    },
                    'azure_mock_persist_enabled': {
                        'type': 'boolean',
                        'title': 'Persist Fixture Mutations',
                        'description': (
                            'Write every save-to-cloud mutation (dates, state, description, relations) '
                            'back to the fixture files in azure_mock_data_dir. '
                            'Allows testing write operations against anonymised fixture data.'
                        ),
                        'default': False,
                        'x-showWhen': 'use_azure_mock',
                    },
                    'stand_alone_mode': {
                        'type': 'boolean',
                        'title': 'Stand-alone Mode',
                        'description': 'Reserved for future use — enables fully offline operation without any Azure DevOps connectivity',
                        'default': False,
                    },
                    'use_azure_mock_generator': {
                        'type': 'boolean',
                        'title': 'Use Azure Synthetic Data Generator',
                        'description': 'Generate a coherent synthetic dataset from config files instead of calling the live API (takes priority over use_azure_mock)',
                        'default': False,
                    },
                    'generator_persist_enabled': {
                        'type': 'boolean',
                        'title': 'Persist Generated Data',
                        'description': (
                            'Write the generated dataset to disk and persist every save-to-cloud mutation. '
                            'Requires a fixed seed (generator_config.seed) for reproducible results. '
                            'Uses generator_persist_dir as the target; defaults to data/azure_mock_generated when not set.'
                        ),
                        'default': False,
                        'x-showWhen': 'use_azure_mock_generator',
                    },
                    'generator_persist_dir': {
                        'type': 'string',
                        'title': 'Generator Persist Directory',
                        'description': 'Directory for persisted fixture files (defaults to data/azure_mock_generated when generator_persist_enabled is true)',
                        'x-showWhen': 'generator_persist_enabled',
                    },
                    'generator_config': {
                        'type': 'object',
                        'title': 'Synthetic Generator Configuration',
                        'description': 'Fine-grained control over the synthetic data generator (used when use_azure_mock_generator is true)',
                        'x-showWhen': 'use_azure_mock_generator',
                        'properties': {
                            'seed': {
                                'type': 'integer',
                                'title': 'Random Seed',
                                'description': 'Fix the seed for reproducible datasets; omit for a random dataset each run',
                            },
                            'n_plans': {
                                'type': 'integer',
                                'title': 'Number of Plans',
                                'default': 6,
                                'minimum': 1,
                            },
                            'default_items_per_area': {
                                'type': 'integer',
                                'title': 'Default Items per Area Path',
                                'default': 20,
                                'minimum': 1,
                            },
                            'n_pis': {
                                'type': 'integer',
                                'title': 'Number of Program Increments',
                                'default': 6,
                                'minimum': 1,
                            },
                            'sprints_per_pi': {
                                'type': 'integer',
                                'title': 'Sprints per PI',
                                'default': 4,
                                'minimum': 1,
                            },
                            'revisions_min': {
                                'type': 'integer',
                                'title': 'Minimum Revisions per Item',
                                'default': 2,
                                'minimum': 1,
                            },
                            'revisions_max': {
                                'type': 'integer',
                                'title': 'Maximum Revisions per Item',
                                'default': 12,
                                'minimum': 1,
                            },
                            'people_per_team': {
                                'type': 'integer',
                                'title': 'People per Team (fallback)',
                                'description': 'Used when no people.yml is available',
                                'default': 7,
                                'minimum': 1,
                            },
                        },
                        'additionalProperties': True,
                    },
                },
                'additionalProperties': True,
            },
            'memory_cache': {
                'type': 'object',
                'title': 'Memory Cache Configuration',
                'description': 'Settings for hot memory cache layer (when enable_memory_cache is true)',
                'x-showWhen': 'feature_flags.enable_memory_cache',
                'properties': {
                    'max_size_mb': {
                        'type': 'integer',
                        'title': 'Max Cache Size (MB)',
                        'description': 'Maximum memory allocated for cache in megabytes',
                        'default': 50,
                        'minimum': 10,
                        'maximum': 500,
                    },
                    'staleness_seconds': {
                        'type': 'integer',
                        'title': 'Staleness Threshold (seconds)',
                        'description': 'Time before cached data is marked stale and eligible for refresh',
                        'default': 1800,
                        'minimum': 60,
                        'maximum': 86400,
                    },
                },
            },
        },
        'required': ['server_name', 'azure_devops_organization'],
    },
    'projects': {
        'type': 'object',
        'title': 'Project Configuration',
        'description': 'Map projects to Azure DevOps area paths (schema v3)',
        'properties': {
            'schema_version': {
                'type': 'integer',
                'title': 'Schema Version',
                'description': 'Configuration schema version',
                'default': 3,
                'minimum': 1,
            },
            'project_map': {
                'type': 'array',
                'title': 'Project Mappings',
                'items': {
                    'type': 'object',
                    'properties': {
                        'name': {
                            'type': 'string',
                            'title': 'Project Name',
                            'minLength': 1,
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
                            'enum': ['project', 'team'],
                            'default': 'project',
                        },
                        'task_types': {
                            'type': 'array',
                            'title': 'Work Item Types',
                            'description': 'Types of work items to include',
                            'items': {'type': 'string'},
                            'default': ['Feature', 'Epic'],
                        },
                        'include_states': {
                            'type': 'array',
                            'title': 'Work Item States to Fetch',
                            'description': 'States of work items to fetch from Azure DevOps',
                            'items': {'type': 'string'},
                            'default': ['new', 'active', 'defined', 'resolved'],
                        },
                        'display_states': {
                            'type': 'array',
                            'title': 'Displayable States',
                            'description': 'States available for selection in UI',
                            'items': {'type': 'string'},
                            'default': ['new', 'active', 'defined', 'resolved', 'closed'],
                        },
                    },
                    'required': ['name', 'area_path'],
                },
            },
        },
        'required': ['project_map'],
    },
    'teams': {
        'type': 'object',
        'title': 'Team Configuration',
        'description': 'Team definitions with names and short identifiers (schema v2)',
        'properties': {
            'schema_version': {
                'type': 'integer',
                'title': 'Schema Version',
                'default': 2,
                'minimum': 1,
            },
            'teams': {
                'type': 'array',
                'title': 'Teams',
                'description': 'List of teams with their identifiers',
                'items': {
                    'type': 'object',
                    'properties': {
                        'name': {
                            'type': 'string',
                            'title': 'Team Name',
                            'minLength': 1,
                        },
                        'short_name': {
                            'type': 'string',
                            'title': 'Short Name',
                            'description': 'Abbreviated team identifier (2-4 characters)',
                            'minLength': 2,
                        },
                        'exclude': {
                            'type': 'boolean',
                            'title': 'Exclude',
                            'description': 'If true, team is excluded from operations but tracked for consistency',
                            'default': False,
                        },
                    },
                    'required': ['name', 'short_name'],
                },
            },
        },
        'required': ['teams'],
    },
    'people': {
        'type': 'object',
        'title': 'People Configuration',
        'description': 'People database configuration with file path and inline overrides (schema v1)',
        'properties': {
            'schema_version': {
                'type': 'integer',
                'title': 'Schema Version',
                'default': 1,
                'minimum': 1,
            },
            'database_file': {
                'type': 'string',
                'title': 'Database File Path',
                'description': 'Path to the main people database YAML file',
                'minLength': 1,
                'default': '/app/data/config/database.yaml',
            },
            'database': {
                'type': 'object',
                'title': 'Database Overrides',
                'description': 'Inline database entries that override entries from the database_file',
                'properties': {
                    'people': {
                        'type': 'array',
                        'title': 'People Entries',
                        'items': {
                            'type': 'object',
                            'properties': {
                                'name': {'type': 'string', 'title': 'Name', 'minLength': 1},
                                'team_name': {'type': 'string', 'title': 'Team Name', 'minLength': 1},
                                'site': {'type': 'string', 'title': 'Site Code', 'minLength': 1},
                                'external': {
                                    'type': 'boolean',
                                    'title': 'External',
                                    'default': False,
                                },
                            },
                            'required': ['name', 'team_name', 'site', 'external'],
                        },
                    },
                },
            },
        },
        'required': ['schema_version'],
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
    'cost': {
        'type': 'object',
        'title': 'Cost Configuration',
        'description': 'Working hours and hourly rates per site',
        'properties': {
            'schema_version': {
                'type': 'integer',
                'title': 'Schema Version',
                'default': 1,
                'minimum': 1,
                'readOnly': True,
            },
            'working_hours': {
                'type': 'object',
                'title': 'Working Hours by Site',
                'patternProperties': {
                    '^[A-Z]+$': {
                        'type': 'object',
                        'properties': {
                            'internal': {'type': 'integer', 'minimum': 0, 'default': 160},
                            'external': {'type': 'integer', 'minimum': 0, 'default': 160},
                        },
                        'required': ['internal', 'external'],
                    },
                },
                'additionalProperties': False,
            },
            'internal_cost': {
                'type': 'object',
                'title': 'Internal Cost',
                'properties': {
                    'default_hourly_rate': {'type': 'number', 'minimum': 0},
                },
                'required': ['default_hourly_rate'],
            },
            'external_cost': {
                'type': 'object',
                'title': 'External Cost',
                'properties': {
                    'default_hourly_rate': {'type': 'number', 'minimum': 0},
                    'external': {
                        'type': 'object',
                        'patternProperties': {'.*': {'type': 'number', 'minimum': 0}},
                        'additionalProperties': False,
                    },
                },
                'required': ['default_hourly_rate'],
            },
        },
        'required': ['schema_version', 'working_hours', 'internal_cost', 'external_cost'],
    },
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_schema(config_type: str) -> Optional[dict]:
    """Return a *copy* of the JSON Schema dict for *config_type*, or ``None``."""
    schema = _SCHEMAS.get(config_type)
    if schema is None:
        return None
    import copy
    return copy.deepcopy(schema)


def enrich_projects_schema(schema: dict, *, azure_client, pat: str, admin_svc) -> None:
    """Mutate the ``projects`` schema in-place with live Azure metadata.

    Fetches work-item types and states from the Azure project inferred from
    the first entry of ``projects.yml``.  Silently no-ops on any error so the
    caller can always return a valid static schema as fallback.
    """
    if not pat:
        return
    try:
        projects_cfg = admin_svc.get_config('projects') or {}
        project_map = projects_cfg.get('project_map', [])
        if not project_map:
            return
        area_path = project_map[0].get('area_path', '')
        azure_project = area_path.split('\\')[0] if '\\' in area_path else None
        if not azure_project:
            return

        with azure_client.connect(pat) as client:
            logger.info("Fetching work item metadata from Azure project '%s'", azure_project)
            metadata = client.get_work_item_metadata(azure_project)

        project_items = schema['properties']['project_map']['items']['properties']
        if metadata.get('types'):
            project_items['task_types']['items']['enum'] = metadata['types']
            logger.info("Retrieved %d work item types from Azure", len(metadata['types']))
        if metadata.get('states'):
            project_items['include_states']['default'] = metadata['states']
            project_items['display_states']['default'] = metadata['states']
            logger.info("Retrieved %d states from Azure", len(metadata['states']))
    except Exception as e:
        logger.warning("Failed to enrich projects schema with Azure metadata: %s", e)
