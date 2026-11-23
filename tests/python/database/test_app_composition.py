"""Application composition exposes the generation's planner database."""
from planner_lib.database import SCHEMA_TARGET, PlannerDatabase


def test_memory_app_owns_an_isolated_current_planner_database(app):
    database = app.state.container.get('planner_database')
    assert isinstance(database, PlannerDatabase)
    assert database.validate() == SCHEMA_TARGET


def test_admin_backup_contains_the_planner_database_section(authenticated_client):
    backup = authenticated_client.get('/admin/v1/backup').json()
    assert backup['planner_database']['schema_version'] == SCHEMA_TARGET
    assert backup['planner_database']['tables']['backend_definitions'] == [
        {'backend_id': 'ado', 'provider': 'azure-devops', 'config_version': 1},
        {'backend_id': 'local', 'provider': 'sqlite', 'config_version': 1},
    ]


def test_diskcache_app_uses_the_active_generation_database(tmp_path):
    from fastapi.testclient import TestClient
    from planner_lib.main import Config, create_app

    app = create_app(Config(data_dir=str(tmp_path), storage_backend='diskcache'))
    with TestClient(app):
        database = app.state.container.get('planner_database')
        generation = app.state.database_handle.storage.data_dir.parent
        assert database.path == generation / 'planner.sqlite'
        assert database.validate() == SCHEMA_TARGET
