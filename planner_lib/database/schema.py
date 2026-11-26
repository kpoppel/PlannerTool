"""Relational schema of the generation-owned ``planner.sqlite``.

Migrations are append-only: never edit an applied entry, add a new one.
Values are typed scalars; JSON is only a transport format, except history
values which store one JSON-encoded scalar each.

Each migration composes fragments owned by the module whose data they hold:
this module owns server settings, backend identity, plan levels, allocation
defaults and iteration presets; ``ado_schema`` and ``planner_lib.local.schema``
own their task backends' tables. Fragment order inside a migration is part of
the applied script and must not change.
"""
from planner_lib.local import schema as local

from . import ado_schema as ado

_SERVER_AND_BACKENDS = """
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    migration_id TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
);

-- Backend identity and reserved typed server settings (populated in a later
-- configuration migration; credentials and login authority never live here).
CREATE TABLE backend_definitions (
    backend_id TEXT PRIMARY KEY CHECK (backend_id IN ('ado', 'local')),
    provider TEXT NOT NULL CHECK (length(provider) > 0),
    config_version INTEGER NOT NULL DEFAULT 1 CHECK (config_version >= 1)
);
CREATE TABLE task_backend_selection (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    backend_id TEXT NOT NULL REFERENCES backend_definitions(backend_id)
);
CREATE TABLE server_settings (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    server_name TEXT,
    log_level TEXT NOT NULL CHECK (log_level IN ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'))
);
CREATE TABLE server_feature_flags (
    flag_name TEXT PRIMARY KEY CHECK (length(flag_name) > 0),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
);
CREATE TABLE cache_policies (
    cache_domain TEXT PRIMARY KEY CHECK (length(cache_domain) > 0),
    ttl_seconds INTEGER NOT NULL CHECK (ttl_seconds > 0)
);
CREATE TABLE backend_feature_flags (
    backend_id TEXT NOT NULL REFERENCES backend_definitions(backend_id),
    flag_name TEXT NOT NULL CHECK (length(flag_name) > 0),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    PRIMARY KEY (backend_id, flag_name)
);
"""

_REGISTER_BACKENDS = """INSERT INTO backend_definitions (backend_id, provider) VALUES ('ado', 'azure-devops'), ('local', 'sqlite');
"""

_SERVER_CONFIGURATION = """
ALTER TABLE server_settings ADD COLUMN log_level_present INTEGER NOT NULL DEFAULT 1
    CHECK (log_level_present IN (0, 1));
ALTER TABLE server_settings ADD COLUMN cache_shape INTEGER NOT NULL DEFAULT 0
    CHECK (cache_shape IN (0, 1, 2));
DROP TABLE cache_policies;
CREATE TABLE cache_policies (
    cache_domain TEXT PRIMARY KEY CHECK (length(cache_domain) > 0),
    ttl_seconds INTEGER NOT NULL CHECK (ttl_seconds >= 0 AND ttl_seconds % 60 = 0)
);
"""

# Plan levels (``ado_plan_kinds``, named before Local plans shared them) and
# allocation defaults are backend-neutral configuration.
_ITERATION_SETS_AND_PLAN_LEVELS = """CREATE TABLE iteration_sets (
    iteration_set_id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(iteration_set_id)) > 0),
    backend_id TEXT NOT NULL REFERENCES backend_definitions(backend_id),
    position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    source_type TEXT NOT NULL CHECK (source_type IN ('ado', 'manual', 'generated')),
    source_project TEXT,
    root_path TEXT,
    cached_at TEXT,
    CHECK ((source_type = 'ado' AND backend_id = 'ado' AND source_project IS NOT NULL)
        OR (source_type <> 'ado' AND backend_id = 'local' AND source_project IS NULL))
);
CREATE TABLE ado_plan_kinds (
    kind TEXT PRIMARY KEY NOT NULL CHECK (length(trim(kind)) > 0),
    position INTEGER NOT NULL UNIQUE CHECK (position >= 0)
);
CREATE TABLE allocation_defaults (
    kind TEXT NOT NULL REFERENCES ado_plan_kinds ON DELETE CASCADE,
    team_id TEXT NOT NULL CHECK (length(team_id) > 0),
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (kind, team_id),
    UNIQUE (kind, position)
);
"""

_ITERATIONS = """CREATE TABLE iteration_selections (
    iteration_set_id TEXT NOT NULL REFERENCES iteration_sets ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    path TEXT NOT NULL,
    PRIMARY KEY (iteration_set_id, position)
);
CREATE TABLE iteration_generators (
    iteration_set_id TEXT PRIMARY KEY NOT NULL REFERENCES iteration_sets ON DELETE CASCADE,
    start_date TEXT NOT NULL,
    length INTEGER NOT NULL CHECK (length BETWEEN 1 AND 366),
    unit TEXT NOT NULL CHECK (unit IN ('days', 'weeks')),
    first_number INTEGER NOT NULL CHECK (first_number BETWEEN 1 AND 99999),
    prefix TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('count', 'until')),
    count INTEGER,
    end_date TEXT,
    CHECK ((mode = 'count' AND count IS NOT NULL) OR (mode = 'until' AND end_date IS NOT NULL))
);
CREATE TABLE iterations (
    iteration_id TEXT PRIMARY KEY NOT NULL,
    iteration_set_id TEXT NOT NULL REFERENCES iteration_sets ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    path TEXT NOT NULL CHECK (length(trim(path)) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    start_date TEXT NOT NULL CHECK (date(start_date) IS start_date),
    finish_date TEXT NOT NULL CHECK (date(finish_date) IS finish_date),
    CHECK (start_date <= finish_date),
    UNIQUE (iteration_set_id, path),
    UNIQUE (iteration_set_id, position)
);
"""

MIGRATIONS = (
    (1, '0001.initial-relational-schema',
     _SERVER_AND_BACKENDS + ado.SETTINGS + local.INITIAL + _REGISTER_BACKENDS),
    (2, '0002.local-catalogue-and-plans', local.CATALOGUE_AND_PLANS),
    (3, '0003.core-configuration',
     _SERVER_CONFIGURATION + ado.TRANSPORTS + local.TASK_ITERATION_REFS + _ITERATION_SETS_AND_PLAN_LEVELS
     + ado.PLANS_AND_PROCESSES + _ITERATIONS),
    (4, '0004.local-document-order', local.DOCUMENT_ORDER),
)
SCHEMA_TARGET = MIGRATIONS[-1][0]
