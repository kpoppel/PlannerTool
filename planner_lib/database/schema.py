"""Relational schema of the generation-owned ``planner.sqlite``.

Migrations are append-only: never edit an applied entry, add a new one.
Values are typed scalars; JSON is only a transport format, except history
values which store one JSON-encoded scalar each.
"""

INITIAL_SCHEMA = """
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
CREATE TABLE ado_settings (
    backend_id TEXT PRIMARY KEY REFERENCES backend_definitions(backend_id)
        CHECK (backend_id = 'ado'),
    organization_url TEXT NOT NULL
);

-- Iterations
CREATE TABLE iteration_sets (
    iteration_set_id TEXT PRIMARY KEY,
    backend_id TEXT NOT NULL REFERENCES backend_definitions(backend_id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    UNIQUE (backend_id, name)
);
CREATE TABLE iterations (
    iteration_id TEXT PRIMARY KEY,
    iteration_set_id TEXT NOT NULL REFERENCES iteration_sets(iteration_set_id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    start_date TEXT NOT NULL CHECK (date(start_date) = start_date),
    finish_date TEXT NOT NULL CHECK (date(finish_date) = finish_date),
    CHECK (start_date <= finish_date),
    UNIQUE (iteration_set_id, name)
);

-- Plans and catalogue
CREATE TABLE plan_kind_definitions (
    kind TEXT PRIMARY KEY CHECK (length(trim(kind)) > 0),
    display_order INTEGER NOT NULL UNIQUE
);
CREATE TABLE plan_definitions (
    plan_id TEXT PRIMARY KEY,
    backend_id TEXT NOT NULL REFERENCES backend_definitions(backend_id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    kind TEXT NOT NULL REFERENCES plan_kind_definitions(kind),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    display_order INTEGER NOT NULL,
    closed_history_days INTEGER NOT NULL DEFAULT 0 CHECK (closed_history_days >= 0),
    area_path TEXT CHECK (area_path IS NULL OR (backend_id = 'ado' AND length(trim(area_path)) > 0)),
    UNIQUE (backend_id, display_order)
);
CREATE TABLE plan_iteration_sets (
    plan_id TEXT PRIMARY KEY REFERENCES plan_definitions(plan_id) ON DELETE CASCADE,
    iteration_set_id TEXT NOT NULL REFERENCES iteration_sets(iteration_set_id)
);
CREATE TABLE plan_markers (
    marker_id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plan_definitions(plan_id) ON DELETE CASCADE,
    label TEXT NOT NULL CHECK (length(trim(label)) > 0),
    marker_date TEXT NOT NULL CHECK (date(marker_date) = marker_date),
    color TEXT
);
CREATE TABLE processes (
    process_id TEXT PRIMARY KEY,
    backend_id TEXT NOT NULL REFERENCES backend_definitions(backend_id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    UNIQUE (backend_id, name)
);
CREATE TABLE process_display_order (
    process_id TEXT PRIMARY KEY REFERENCES processes(process_id) ON DELETE CASCADE,
    backend_id TEXT NOT NULL REFERENCES backend_definitions(backend_id),
    position INTEGER NOT NULL CHECK (position >= 0),
    UNIQUE (backend_id, position)
);
CREATE TABLE task_types (
    type_id TEXT PRIMARY KEY,
    process_id TEXT NOT NULL REFERENCES processes(process_id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    backlog_level TEXT NOT NULL CHECK (backlog_level IN ('portfolio', 'requirement', 'task', 'none')),
    UNIQUE (process_id, name)
);
CREATE TABLE type_display_tiers (
    type_id TEXT PRIMARY KEY REFERENCES task_types(type_id) ON DELETE CASCADE,
    tier INTEGER NOT NULL CHECK (tier >= 0),
    position INTEGER NOT NULL CHECK (position >= 0)
);
CREATE TABLE task_type_parent_rules (
    parent_type_id TEXT NOT NULL REFERENCES task_types(type_id) ON DELETE CASCADE,
    child_type_id TEXT NOT NULL REFERENCES task_types(type_id) ON DELETE CASCADE,
    PRIMARY KEY (parent_type_id, child_type_id),
    CHECK (parent_type_id <> child_type_id)
);
CREATE TABLE plan_task_types (
    plan_id TEXT NOT NULL REFERENCES plan_definitions(plan_id) ON DELETE CASCADE,
    type_id TEXT NOT NULL REFERENCES task_types(type_id),
    PRIMARY KEY (plan_id, type_id)
);

-- Reusable field schemas
CREATE TABLE field_definitions (
    field_id TEXT PRIMARY KEY,
    backend_id TEXT NOT NULL REFERENCES backend_definitions(backend_id),
    field_key TEXT NOT NULL CHECK (field_key GLOB '[a-z]*' AND field_key NOT GLOB '*[^a-z0-9_]*'),
    label TEXT NOT NULL CHECK (length(trim(label)) > 0),
    value_type TEXT NOT NULL CHECK (value_type IN ('string', 'text', 'integer', 'number', 'boolean', 'date', 'enum')),
    UNIQUE (backend_id, field_key)
);
CREATE TABLE field_enum_options (
    field_id TEXT NOT NULL REFERENCES field_definitions(field_id) ON DELETE CASCADE,
    option_value TEXT NOT NULL CHECK (length(option_value) > 0),
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (field_id, option_value),
    UNIQUE (field_id, position)
);
CREATE TABLE field_schemas (
    schema_id TEXT PRIMARY KEY,
    backend_id TEXT NOT NULL REFERENCES backend_definitions(backend_id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    UNIQUE (backend_id, name)
);
CREATE TABLE field_schema_fields (
    schema_id TEXT NOT NULL REFERENCES field_schemas(schema_id) ON DELETE CASCADE,
    field_id TEXT NOT NULL REFERENCES field_definitions(field_id),
    position INTEGER NOT NULL CHECK (position >= 0),
    required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
    default_text TEXT,
    default_integer INTEGER,
    default_real REAL,
    min_value REAL,
    max_value REAL,
    max_length INTEGER CHECK (max_length IS NULL OR max_length > 0),
    PRIMARY KEY (schema_id, field_id),
    UNIQUE (schema_id, position),
    CHECK ((default_text IS NOT NULL) + (default_integer IS NOT NULL) + (default_real IS NOT NULL) <= 1),
    CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);
CREATE TABLE task_type_field_schemas (
    type_id TEXT PRIMARY KEY REFERENCES task_types(type_id) ON DELETE CASCADE,
    schema_id TEXT NOT NULL REFERENCES field_schemas(schema_id)
);

-- States and workflows
CREATE TABLE states (
    state_id TEXT PRIMARY KEY,
    backend_id TEXT NOT NULL REFERENCES backend_definitions(backend_id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    category TEXT NOT NULL CHECK (category IN ('Proposed', 'InProgress', 'Resolved', 'Completed', 'Removed')),
    display_order INTEGER NOT NULL CHECK (display_order >= 0),
    UNIQUE (backend_id, name)
);
CREATE TABLE workflows (
    workflow_id TEXT PRIMARY KEY,
    backend_id TEXT NOT NULL REFERENCES backend_definitions(backend_id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    UNIQUE (backend_id, name)
);
CREATE TABLE workflow_states (
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
    state_id TEXT NOT NULL REFERENCES states(state_id),
    position INTEGER NOT NULL CHECK (position >= 0),
    is_initial INTEGER NOT NULL DEFAULT 0 CHECK (is_initial IN (0, 1)),
    PRIMARY KEY (workflow_id, state_id),
    UNIQUE (workflow_id, position)
);
-- At most one initial state per workflow; "at least one" is enforced on save.
CREATE UNIQUE INDEX workflow_single_initial ON workflow_states(workflow_id) WHERE is_initial = 1;
CREATE TABLE workflow_transitions (
    workflow_id TEXT NOT NULL,
    from_state_id TEXT NOT NULL,
    to_state_id TEXT NOT NULL,
    PRIMARY KEY (workflow_id, from_state_id, to_state_id),
    FOREIGN KEY (workflow_id, from_state_id) REFERENCES workflow_states(workflow_id, state_id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_id, to_state_id) REFERENCES workflow_states(workflow_id, state_id) ON DELETE CASCADE,
    CHECK (from_state_id <> to_state_id)
);
CREATE TABLE task_type_workflows (
    type_id TEXT PRIMARY KEY REFERENCES task_types(type_id) ON DELETE CASCADE,
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id)
);

-- Tasks
CREATE TABLE tasks (
    task_id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plan_definitions(plan_id),
    type_id TEXT NOT NULL REFERENCES task_types(type_id),
    state_id TEXT NOT NULL REFERENCES states(state_id),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description TEXT,
    assignee TEXT,
    start_date TEXT CHECK (start_date IS NULL OR date(start_date) = start_date),
    end_date TEXT CHECK (end_date IS NULL OR date(end_date) = end_date),
    iteration_id TEXT REFERENCES iterations(iteration_id),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    deleted_at TEXT,
    CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);
CREATE INDEX tasks_active_plan ON tasks(plan_id) WHERE deleted_at IS NULL;
CREATE INDEX tasks_type ON tasks(type_id);
CREATE INDEX tasks_state ON tasks(state_id);
CREATE TABLE task_custom_values (
    task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    field_id TEXT NOT NULL REFERENCES field_definitions(field_id),
    value_text TEXT,
    value_integer INTEGER,
    value_real REAL,
    PRIMARY KEY (task_id, field_id),
    CHECK ((value_text IS NOT NULL) + (value_integer IS NOT NULL) + (value_real IS NOT NULL) = 1)
);
CREATE TABLE task_allocations (
    task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    team_id TEXT NOT NULL CHECK (length(team_id) > 0),
    capacity REAL NOT NULL CHECK (capacity >= 0),
    PRIMARY KEY (task_id, team_id)
);
CREATE INDEX task_allocations_team ON task_allocations(team_id);
CREATE TABLE task_tags (
    task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    tag TEXT NOT NULL CHECK (length(trim(tag)) > 0),
    PRIMARY KEY (task_id, tag)
);
-- parent: source is the parent of target; dependency: source precedes target.
CREATE TABLE task_relations (
    source_task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    target_task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('parent', 'dependency', 'related')),
    PRIMARY KEY (source_task_id, target_task_id, kind),
    CHECK (source_task_id <> target_task_id)
);
CREATE UNIQUE INDEX task_single_parent ON task_relations(target_task_id) WHERE kind = 'parent';
CREATE INDEX task_relations_target ON task_relations(target_task_id, kind);

-- Audit: retained in full for the MVP so scenario bases remain verifiable.
CREATE TABLE task_history (
    history_id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(task_id),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    field_key TEXT NOT NULL CHECK (length(field_key) > 0),
    old_value TEXT CHECK (old_value IS NULL OR json_valid(old_value)),
    new_value TEXT CHECK (new_value IS NULL OR json_valid(new_value)),
    actor_id TEXT NOT NULL,
    changed_at TEXT NOT NULL,
    batch_id TEXT NOT NULL
);
CREATE INDEX task_history_task ON task_history(task_id, revision);

INSERT INTO backend_definitions (backend_id, provider) VALUES ('ado', 'azure-devops'), ('local', 'sqlite');
"""

# Plan kinds and iteration sets stay in the configuration store, so their links
# become application-checked; local plans gain allocation overrides; workflows
# gain explicit "from any state" transitions; documents gain revisions.
LOCAL_CATALOGUE_AND_PLANS = """
CREATE TABLE plan_definitions_rebuilt (
    plan_id TEXT PRIMARY KEY,
    backend_id TEXT NOT NULL REFERENCES backend_definitions(backend_id),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    kind TEXT NOT NULL CHECK (length(trim(kind)) > 0),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    display_order INTEGER NOT NULL,
    closed_history_days INTEGER NOT NULL DEFAULT 0 CHECK (closed_history_days >= 0),
    area_path TEXT CHECK (area_path IS NULL OR (backend_id = 'ado' AND length(trim(area_path)) > 0)),
    allocation_override INTEGER NOT NULL DEFAULT 0 CHECK (allocation_override IN (0, 1)),
    UNIQUE (backend_id, display_order)
);
INSERT INTO plan_definitions_rebuilt
    (plan_id, backend_id, name, kind, archived, display_order, closed_history_days, area_path)
    SELECT plan_id, backend_id, name, kind, archived, display_order, closed_history_days, area_path
    FROM plan_definitions;
DROP TABLE plan_definitions;
ALTER TABLE plan_definitions_rebuilt RENAME TO plan_definitions;
DROP TABLE plan_kind_definitions;

CREATE TABLE plan_iteration_sets_rebuilt (
    plan_id TEXT PRIMARY KEY REFERENCES plan_definitions(plan_id) ON DELETE CASCADE,
    iteration_set_id TEXT NOT NULL CHECK (length(iteration_set_id) > 0)
);
INSERT INTO plan_iteration_sets_rebuilt SELECT plan_id, iteration_set_id FROM plan_iteration_sets;
DROP TABLE plan_iteration_sets;
ALTER TABLE plan_iteration_sets_rebuilt RENAME TO plan_iteration_sets;

CREATE TABLE plan_allocatable_teams (
    plan_id TEXT NOT NULL REFERENCES plan_definitions(plan_id) ON DELETE CASCADE,
    team_id TEXT NOT NULL CHECK (length(team_id) > 0),
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (plan_id, team_id),
    UNIQUE (plan_id, position)
);
CREATE TABLE workflow_any_transitions (
    workflow_id TEXT NOT NULL,
    to_state_id TEXT NOT NULL,
    PRIMARY KEY (workflow_id, to_state_id),
    FOREIGN KEY (workflow_id, to_state_id) REFERENCES workflow_states(workflow_id, state_id) ON DELETE CASCADE
);
CREATE TABLE document_revisions (
    document TEXT PRIMARY KEY CHECK (document IN ('local_catalogue', 'local_plans')),
    revision INTEGER NOT NULL CHECK (revision >= 0)
);
INSERT INTO document_revisions VALUES ('local_catalogue', 0), ('local_plans', 0);
"""

MIGRATIONS = (
    (1, '0001.initial-relational-schema', INITIAL_SCHEMA),
    (2, '0002.local-catalogue-and-plans', LOCAL_CATALOGUE_AND_PLANS),
)
SCHEMA_TARGET = MIGRATIONS[-1][0]
