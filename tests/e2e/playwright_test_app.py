import os

from planner_lib.main import Config, create_app


# Playwright e2e server factory: always use isolated test data storage.
def make_app():
    return create_app(Config(data_dir=os.environ['PLANNER_E2E_TEST_DATA_DIR']))


def make_auth_app():
    from unittest.mock import patch
    from planner_lib.azure.AzureClient import AzureClient
    from planner_lib.backend.errors import BackendAuthError

    class FixturePatClient(AzureClient):
        def _connect_with_pat(self, pat):
            self._connection_state.fixture_pat = pat
            self._connected = True

        def get_projects(self):
            if self._connection_state.fixture_pat != 'auth-e2e-fixture-pat':
                raise BackendAuthError('Fixture PAT rejected')
            return []

    data_dir = os.environ['PLANNER_AUTH_TEST_DATA_DIR']
    app = create_app(Config(data_dir=data_dir, enable_brotli=True))
    app.state.pat_validation_patch = patch('planner_lib.azure.AzureClient.AzureClient', FixturePatClient)
    app.state.pat_validation_patch.start()
    storage = app.state.container.get('storage')
    storage.save('config', 'projects', {
        'schema_version': 4, 'container_types': ['project', 'team'], 'project_map': [],
        'allocation_defaults': {'project': [], 'team': []},
    })
    storage.save('config', 'teams', {'schema_version': 3, 'teams': [], 'groups': []})
    storage.save('config', 'workforce', {'schema_version': 2, 'suppliers': [], 'staffing': []})
    return app
