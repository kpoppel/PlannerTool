import os

from planner_lib.main import Config, create_app


# Playwright e2e server factory: always use isolated test data storage.
def make_app():
    return create_app(Config(data_dir=os.environ['PLANNER_E2E_TEST_DATA_DIR']))


def make_local_task_app():
    from planner_lib.migrations.coordinator import Database

    data_dir = os.environ['PLANNER_E2E_TEST_DATA_DIR']
    handle = Database(data_dir).prepare()
    try:
        config = handle.storage.load('config', 'server_config')
        config['task_backend_id'] = 'local'
        config['feature_flags']['enable_cache'] = True
        handle.storage.save('config', 'server_config', config)
    finally:
        handle.close()
    return create_app(Config(data_dir=data_dir))


def make_auth_app():
    data_dir = os.environ['PLANNER_AUTH_TEST_DATA_DIR']
    app = create_app(Config(data_dir=data_dir, enable_brotli=True))
    storage = app.state.container.get('storage')
    storage.save('config', 'projects', {
        'schema_version': 4, 'container_types': ['project', 'team'], 'project_map': [],
        'allocation_defaults': {'project': [], 'team': []},
    })
    storage.save('config', 'teams', {'schema_version': 3, 'teams': [], 'groups': []})
    storage.save('config', 'workforce', {'schema_version': 2, 'suppliers': [], 'staffing': []})
    return app
