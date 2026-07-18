from planner_lib.main import Config, create_app


def _make_app_with_brotli_flag(enabled: bool):
    from planner_lib.storage.memory_backend import MemoryStorage
    import planner_lib.storage.memory_backend as mem_mod

    shared = MemoryStorage()
    shared.save('config', 'server_config', {
        'feature_flags': {
            'enable_brotli_middleware': enabled,
        }
    })
    shared.save('config', 'people', {
        'schema_version': 1,
        'database_file': '',
        'database': {'people': []},
    })

    original = mem_mod.MemoryStorage
    mem_mod.MemoryStorage = lambda: shared
    try:
        # Keep config fallback off so the feature flag is the controlling input.
        return create_app(Config(
            storage_backend='memory',
            config_storage_backend='memory',
            enable_brotli=False,
        ))
    finally:
        mem_mod.MemoryStorage = original


def _middleware_names(app):
    return [m.cls.__name__ for m in app.user_middleware]


def test_brotli_middleware_enabled_by_feature_flag():
    app = _make_app_with_brotli_flag(True)
    names = _middleware_names(app)
    assert 'BrotliCompression' in names
    assert 'GZipMiddleware' in names


def test_brotli_middleware_disabled_by_feature_flag():
    app = _make_app_with_brotli_flag(False)
    names = _middleware_names(app)
    assert 'BrotliCompression' not in names
    assert 'GZipMiddleware' in names
