"""Configuration reload and invalidation contracts."""

from unittest.mock import MagicMock


def _config_storage(log_level=None):
    server = {'feature_flags': {}, 'task_backend_id': 'ado'}
    if log_level is not None:
        server['log_level'] = log_level
    configs = {
        ('config', 'server_config'): server,
        ('config', 'ado_config'): {'organization_url': '', 'feature_flags': {}, 'transport': 'live'},
    }
    storage = MagicMock()
    storage.load.side_effect = lambda namespace, key: configs[(namespace, key)]
    return storage


def _make_admin_service(config_data=None):
    """Return an AdminService backed by simple in-memory mocks."""
    from planner_lib.admin.service import AdminService

    storage = _config_storage()

    azure_client = MagicMock()
    azure_client.organization_url = None
    azure_client.feature_flags = None

    return AdminService(
        storage=storage,
        project_repository=None,
        account_manager=MagicMock(),
        azure_client=azure_client,
    )



def test_admin_reload_config_accepts_no_arguments():
    """reload_config() must accept zero arguments and return {'ok': True}."""
    svc = _make_admin_service()
    result = svc.reload_config()
    assert result == {'ok': True}



def test_admin_reload_config_calls_reload_on_reloadable_services():
    """reload_config() calls reload() on injected services that implement Reloadable."""
    from planner_lib.admin.service import AdminService

    class FakeReloadable:
        reloaded = False
        def reload(self):
            self.reloaded = True

    people = FakeReloadable()
    storage = _config_storage()
    azure_client = MagicMock()
    azure_client.organization_url = None
    azure_client.feature_flags = None

    svc = AdminService(
        storage=storage,
        project_repository=None,
        account_manager=MagicMock(),
        azure_client=azure_client,
        reloadable_services=[people],
    )
    svc.reload_config()
    assert people.reloaded, "reload() should have been called on the people service"



def test_admin_reload_config_calls_invalidate_on_invalidatable_cost():
    """reload_config() calls invalidate_cache() on the cost service."""
    from planner_lib.admin.service import AdminService

    class FakeInvalidatable:
        invalidated = False
        def invalidate_cache(self):
            self.invalidated = True

    cost = FakeInvalidatable()
    storage = _config_storage()
    azure_client = MagicMock()
    azure_client.organization_url = None
    azure_client.feature_flags = None

    svc = AdminService(
        storage=storage,
        project_repository=None,
        account_manager=MagicMock(),
        azure_client=azure_client,
        reloadable_services=[cost],
    )
    svc.reload_config()
    assert cost.invalidated, "invalidate_cache() should have been called on cost service"



def test_admin_reload_config_applies_server_log_level(monkeypatch):
    """Saving a system log level must take effect without restarting the server."""
    import logging
    from planner_lib.admin.service import AdminService

    storage = _config_storage('DEBUG')
    azure_client = MagicMock()
    azure_client.organization_url = None
    azure_client.feature_flags = None

    monkeypatch.setattr(logging.getLogger(), 'setLevel', MagicMock())
    svc = AdminService(
        storage=storage,
        project_repository=None,
        account_manager=MagicMock(),
        azure_client=azure_client,
    )

    svc.reload_config()

    logging.getLogger().setLevel.assert_called_once_with(logging.DEBUG)

