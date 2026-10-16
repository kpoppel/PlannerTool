import os

from planner_lib.main import Config, create_app


# Playwright e2e server factory: always use isolated test data storage.
def make_app():
    return create_app(Config(data_dir=os.environ['PLANNER_E2E_TEST_DATA_DIR']))


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
