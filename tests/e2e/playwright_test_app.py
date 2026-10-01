from planner_lib.main import Config, create_app


# Playwright e2e server factory: always use isolated test data storage.
def make_app():
    return create_app(Config(data_dir='tests/e2e/.tmp-data'))


def make_auth_app():
    import os
    from planner_lib.storage.diskcache_backend import DiskCacheStorage
    data_dir = os.environ['PLANNER_AUTH_TEST_DATA_DIR']
    storage = DiskCacheStorage(data_dir + '/cache')
    storage.save('config', 'projects', {'schema_version': 3, 'container_types': ['project', 'team'], 'project_map': []})
    storage.save('config', 'teams', {'schema_version': 2, 'teams': []})
    storage.save('config', 'people', {'schema_version': 1, 'database_file': '', 'database': {'people': []}})
    storage.close()
    return create_app(Config(data_dir=data_dir, enable_brotli=True))
