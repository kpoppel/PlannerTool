"""Public service keys required by application consumers."""


def test_history_repository_key_in_service_keys():
    from planner_lib.services.container import ServiceKeys
    assert hasattr(ServiceKeys, 'HISTORY_REPOSITORY')
    assert ServiceKeys.HISTORY_REPOSITORY == 'history_repository'



def test_history_repository_registered_in_app(app):
    """The session-scoped app must have history_repository in the container."""
    container = app.state.container
    history_repo = container.get('history_repository')
    assert history_repo is not None



def test_cache_coordinator_registered_in_app(app):
    coordinator = app.state.container.get("cache_coordinator")
    assert coordinator is not None



def test_health_config_registered_in_app(app):
    health_cfg = app.state.container.get("health_config")
    assert health_cfg is not None



def test_task_repository_registered_in_app(app):
    """TaskRepository must be available from the DI container."""
    repo = app.state.container.get("task_repository")
    assert repo is not None

