from fastapi.testclient import TestClient
import pytest

from planner_lib.main import Config, create_app
from planner_lib.migrations.contracts import SchemaError, TARGET_REVISION
from planner_lib.migrations.coordinator import Database


def test_factory_prepares_generation_and_shutdown_releases_lease(tmp_path):
    static = tmp_path / 'static'
    static.mkdir()
    (static / 'index.html').write_text('<html><head></head></html>')
    app = create_app(Config(data_dir=str(tmp_path / 'installation'), static_dir=str(static)))
    assert app.state.container.get('storage').exists('system', 'schema_state')
    with TestClient(app):
        with pytest.raises(SchemaError):
            Database(tmp_path / 'installation', lock_timeout=0).prune()
    Database(tmp_path / 'installation', lock_timeout=0).prune()


def test_factory_rejects_unverifiable_database_before_logging(tmp_path, monkeypatch):
    from planner_lib import main
    (tmp_path / 'cache').mkdir()
    monkeypatch.setattr(main, 'configure_logging', lambda *args: pytest.fail('logging ran before schema gate'))
    with pytest.raises(SchemaError):
        create_app(Config(data_dir=str(tmp_path)))


def test_factory_environment_root(monkeypatch, tmp_path):
    monkeypatch.setenv('DATA_DIR', str(tmp_path))
    assert Config().data_dir == str(tmp_path)


def test_construction_failure_releases_database_lease(tmp_path):
    with pytest.raises(RuntimeError):
        create_app(Config(data_dir=str(tmp_path), static_dir=str(tmp_path / 'missing-static')))
    Database(tmp_path, lock_timeout=0).prune()


def test_current_generation_missing_config_is_not_repaired(tmp_path, monkeypatch):
    from planner_lib import main
    handle = Database(tmp_path).prepare()
    handle.storage.delete('config', 'server_config')
    handle.close()
    monkeypatch.setattr(main, 'configure_logging', lambda *args: pytest.fail('logging ran before validation'))
    with pytest.raises(SchemaError):
        create_app(Config(data_dir=str(tmp_path)))


def test_closed_database_handle_cannot_reopen_storage_for_unleased_writes(tmp_path):
    handle = Database(tmp_path).prepare()
    handle.close()
    with pytest.raises(RuntimeError, match='closed'):
        handle.storage.save('opaque', 'after-shutdown', 'forbidden')


def test_isolated_app_fixture_keeps_current_schema(app):
    assert app.state.container.get('storage').load('system', 'schema_state')['schema_revision'] == TARGET_REVISION


def test_fresh_factory_selects_canonical_workforce_and_current_schema(tmp_path):
    from planner_lib.admin.workforce_service import WorkforceAdminService
    from planner_lib.backend.config import WorkforceConfigBackend
    from planner_lib.cost.service import WorkforceCostService
    from planner_lib.repository.team_repository import TeamRepository

    static = tmp_path / 'static'
    static.mkdir()
    (static / 'index.html').write_text('<html><head></head></html>')
    app = create_app(Config(data_dir=str(tmp_path / 'installation'), static_dir=str(static)))
    with TestClient(app):
        container = app.state.container
        storage = container.get('storage')
        assert storage.load('system', 'schema_state')['schema_revision'] == TARGET_REVISION
        assert storage.load('config', 'teams') == {'schema_version': 3, 'teams': [], 'groups': []}
        assert storage.load('config', 'workforce') == {'schema_version': 2, 'suppliers': [], 'staffing': []}
        assert isinstance(container.get('config_backend'), WorkforceConfigBackend)
        assert isinstance(container.get('team_repository'), TeamRepository)
        assert isinstance(container.get('cost_service'), WorkforceCostService)
        assert isinstance(container.get('admin_service'), WorkforceAdminService)
        assert not storage.exists('config', 'people')