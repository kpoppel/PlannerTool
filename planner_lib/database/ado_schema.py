"""Relational tables owned by the Azure DevOps task backend.

Fragments are composed into the append-only ``planner.sqlite`` migrations by
``planner_lib.database.schema``; never edit an applied fragment, add a new one.
"""

# 0001: connection settings.
SETTINGS = """CREATE TABLE ado_settings (
    backend_id TEXT PRIMARY KEY REFERENCES backend_definitions(backend_id)
        CHECK (backend_id = 'ado'),
    organization_url TEXT NOT NULL
);
"""

# 0003: transport selection and the settings of the non-live transports.
TRANSPORTS = """ALTER TABLE ado_settings ADD COLUMN transport TEXT NOT NULL DEFAULT 'live'
    CHECK (transport IN ('live', 'mock_generator', 'mock_fixture', 'static'));
ALTER TABLE ado_settings ADD COLUMN url_present INTEGER NOT NULL DEFAULT 1
    CHECK (url_present IN (0, 1));
ALTER TABLE ado_settings ADD COLUMN flags_present INTEGER NOT NULL DEFAULT 1
    CHECK (flags_present IN (0, 1));

CREATE TABLE ado_transport_paths (
    scope TEXT PRIMARY KEY NOT NULL CHECK (scope IN ('server', 'ado')),
    data_dir TEXT,
    generator_persist_dir TEXT,
    azure_mock_data_dir TEXT,
    static_data_path TEXT
);
CREATE TABLE ado_generator_settings (
    scope TEXT PRIMARY KEY NOT NULL CHECK (scope IN ('server', 'ado')),
    seed INTEGER,
    n_plans INTEGER CHECK (n_plans > 0),
    default_items_per_area INTEGER CHECK (default_items_per_area > 0),
    n_pis INTEGER CHECK (n_pis > 0),
    sprints_per_pi INTEGER CHECK (sprints_per_pi > 0),
    revisions_min INTEGER CHECK (revisions_min > 0),
    revisions_max INTEGER CHECK (revisions_max >= revisions_min AND revisions_max > 0),
    people_per_team INTEGER CHECK (people_per_team > 0),
    persist_dir TEXT,
    seed_present INTEGER NOT NULL CHECK (seed_present IN (0, 1)),
    items_present INTEGER NOT NULL CHECK (items_present IN (0, 1)),
    weights_present INTEGER NOT NULL CHECK (weights_present IN (0, 1))
);
CREATE TABLE ado_generator_items_by_area (
    scope TEXT NOT NULL REFERENCES ado_generator_settings ON DELETE CASCADE,
    area_path TEXT NOT NULL,
    item_count INTEGER NOT NULL CHECK (item_count >= 0),
    PRIMARY KEY (scope, area_path)
);
CREATE TABLE ado_generator_state_weights (
    scope TEXT NOT NULL REFERENCES ado_generator_settings ON DELETE CASCADE,
    type_name TEXT NOT NULL,
    new_weight REAL NOT NULL CHECK (new_weight >= 0),
    defined_weight REAL NOT NULL CHECK (defined_weight >= 0),
    active_weight REAL NOT NULL CHECK (active_weight >= 0),
    resolved_weight REAL NOT NULL CHECK (resolved_weight >= 0),
    closed_weight REAL NOT NULL CHECK (closed_weight >= 0),
    PRIMARY KEY (scope, type_name)
);

"""

# 0003: area-path plans, imported processes and their display order, area mappings.
PLANS_AND_PROCESSES = """CREATE TABLE ado_projects (
    project_id TEXT PRIMARY KEY NOT NULL,
    position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    kind TEXT NOT NULL REFERENCES ado_plan_kinds,
    area_path TEXT NOT NULL CHECK (length(trim(area_path)) > 0),
    closed_history_days INTEGER NOT NULL CHECK (closed_history_days >= 0),
    archived INTEGER CHECK (archived IN (0, 1)),
    iteration_present INTEGER NOT NULL CHECK (iteration_present IN (0, 1)),
    iteration_id TEXT REFERENCES iteration_sets(iteration_set_id),
    allocation_override INTEGER NOT NULL CHECK (allocation_override IN (0, 1))
);
CREATE TABLE ado_project_task_types (
    project_id TEXT NOT NULL REFERENCES ado_projects ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    PRIMARY KEY (project_id, position)
);
CREATE TABLE ado_project_allocation (
    project_id TEXT NOT NULL REFERENCES ado_projects ON DELETE CASCADE,
    team_id TEXT NOT NULL CHECK (length(team_id) > 0),
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (project_id, team_id),
    UNIQUE (project_id, position)
);
CREATE TABLE ado_processes (
    process_id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(process_id)) > 0),
    backend_id TEXT NOT NULL DEFAULT 'ado' REFERENCES backend_definitions CHECK (backend_id = 'ado'),
    position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    parent_name TEXT,
    loaded_at TEXT NOT NULL
);
CREATE TABLE ado_process_projects (
    process_id TEXT NOT NULL REFERENCES ado_processes ON DELETE CASCADE,
    project_name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(project_name)) > 0),
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (process_id, position)
);
CREATE TABLE ado_task_types (
    process_id TEXT NOT NULL REFERENCES ado_processes ON DELETE CASCADE,
    reference_name TEXT NOT NULL CHECK (length(trim(reference_name)) > 0),
    position INTEGER NOT NULL CHECK (position >= 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    backlog_level TEXT NOT NULL CHECK (backlog_level IN ('portfolio', 'requirement', 'task', 'none')),
    backlog TEXT,
    imported INTEGER NOT NULL CHECK (imported IN (0, 1)),
    missing INTEGER NOT NULL CHECK (missing IN (0, 1)),
    PRIMARY KEY (process_id, reference_name),
    UNIQUE (process_id, name),
    UNIQUE (process_id, position)
);
CREATE TABLE ado_task_type_states (
    process_id TEXT NOT NULL,
    reference_name TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    category TEXT NOT NULL CHECK (category IN ('Proposed', 'InProgress', 'Resolved', 'Completed', 'Removed')),
    display_order INTEGER NOT NULL,
    FOREIGN KEY (process_id, reference_name) REFERENCES ado_task_types ON DELETE CASCADE,
    PRIMARY KEY (process_id, reference_name, name),
    UNIQUE (process_id, reference_name, position)
);
CREATE TABLE ado_process_display_order (
    process_id TEXT PRIMARY KEY NOT NULL REFERENCES ado_processes DEFERRABLE INITIALLY DEFERRED,
    position INTEGER NOT NULL UNIQUE CHECK (position >= 0)
);
CREATE TABLE ado_type_display_tiers (
    process_id TEXT NOT NULL REFERENCES ado_process_display_order ON DELETE CASCADE,
    name TEXT NOT NULL,
    tier INTEGER NOT NULL CHECK (tier >= 0),
    position INTEGER NOT NULL CHECK (position >= 0),
    FOREIGN KEY (process_id, name) REFERENCES ado_task_types(process_id, name) DEFERRABLE INITIALLY DEFERRED,
    PRIMARY KEY (process_id, name),
    UNIQUE (process_id, tier, position)
);
CREATE TABLE area_mapping_settings (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    last_update TEXT
);
CREATE TABLE area_mapping_projects (
    project_id TEXT PRIMARY KEY NOT NULL,
    position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
    last_update TEXT,
    areas_present INTEGER NOT NULL CHECK (areas_present IN (0, 1))
);
CREATE TABLE area_mappings (
    project_id TEXT NOT NULL REFERENCES area_mapping_projects ON DELETE CASCADE,
    area_path TEXT NOT NULL CHECK (length(trim(area_path)) > 0),
    position INTEGER NOT NULL CHECK (position >= 0),
    last_update TEXT,
    plans_shape INTEGER NOT NULL CHECK (plans_shape IN (0, 1, 2)),
    PRIMARY KEY (project_id, area_path),
    UNIQUE (project_id, position)
);
CREATE TABLE area_delivery_plans (
    project_id TEXT NOT NULL,
    area_path TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    delivery_plan_id TEXT NOT NULL,
    name TEXT,
    enabled INTEGER CHECK (enabled IN (0, 1)),
    FOREIGN KEY (project_id, area_path) REFERENCES area_mappings ON DELETE CASCADE,
    PRIMARY KEY (project_id, area_path, position)
);
"""
