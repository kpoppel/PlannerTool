from planner_lib.main import Config, create_app


# Playwright e2e server factory: always use isolated test data storage.
def make_app():
    return create_app(Config(data_dir='tests/e2e/.tmp-data'))
