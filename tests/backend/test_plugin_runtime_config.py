import pytest
from importlib import import_module

from planner_lib.admin.plugin_runtime_config import normalize_plugin_runtime_config


def test_plugin_runtime_config_rejects_legacy_settings_and_invalid_placement():
    with pytest.raises(ValueError, match='migrate.py'):
        normalize_plugin_runtime_config({'schema_version': 1, 'plugins': []})
    with pytest.raises(ValueError, match='legacy plugin settings'):
        normalize_plugin_runtime_config({'schema_version': 2, 'plugins': [{'id': 'demo', 'activated': True}]})
    with pytest.raises(ValueError, match='menuPosition'):
        normalize_plugin_runtime_config({'schema_version': 2, 'plugins': [{'id': 'demo', 'menuPosition': 'left'}]})


def test_plugin_runtime_migration_preserves_sequence_settings_and_is_idempotent():
    migration = import_module('scripts.migrations.0031_harmonise_plugin_runtime_config')
    original = {'schema_version': 1, 'plugins': [
        {'id': 'beta', 'enabled': True, 'activated': True, 'order': 9, 'custom_config': {'x': 2}},
        {'id': 'alpha', 'enabled': False, 'activated': False, 'order': 0, 'custom_config': {}},
        {'id': 'sample-menu-plugin', 'enabled': True, 'activated': False, 'custom_config': {'initialCount': 4}},
    ]}
    migrated = migration.migrate_config(original, {'sample-menu-plugin': 'before-tools'})
    assert migrated['schema_version'] == 2
    assert [entry['id'] for entry in migrated['plugins']] == ['beta', 'alpha', 'sample-menu-plugin']
    assert migrated['plugins'][0]['activateOnStartup'] is True
    assert migrated['plugins'][0]['custom_config'] == {'x': 2}
    assert migrated['plugins'][1]['enabled'] is False
    assert migrated['plugins'][2]['menuPosition'] == 'before-tools'
    assert migrated['plugins'][2]['custom_config'] == {'initialCount': 4}
    assert all('order' not in entry and 'activated' not in entry for entry in migrated['plugins'])
    assert migration.migrate_config(migrated, {'sample-menu-plugin': 'before-tools'}) == migrated
    assert original['plugins'][0]['activated'] is True


def test_plugin_runtime_migration_dry_run_backup_and_storage(tmp_path, monkeypatch):
    import json
    from planner_lib.storage.diskcache_backend import DiskCacheStorage

    migration = import_module('scripts.migrations.0031_harmonise_plugin_runtime_config')
    monkeypatch.setattr(migration, '__file__', str(tmp_path / 'scripts' / 'migrations' / '0031.py'))
    metadata_dir = tmp_path / 'www' / 'js'
    metadata_dir.mkdir(parents=True)
    (metadata_dir / 'modules.config.json').write_text(json.dumps({'modules': [
        {'id': 'sample-menu-plugin', 'type': 'menu', 'menuPosition': 'before-tools'},
    ]}))
    storage = DiskCacheStorage(tmp_path / 'data' / 'cache')
    original = {'schema_version': 1, 'plugins': [
        {'id': 'alpha', 'enabled': True, 'activated': True, 'order': 0, 'custom_config': {'x': 2}},
    ]}
    try:
        storage.save('config', 'plugin_runtime_config', original)
        migration.upgrade(dry_run=True, backup=True)
        assert storage.load('config', 'plugin_runtime_config') == original
        assert not storage.exists('config_backup', 'plugin_runtime_config_before_v2')
        migration.upgrade(backup=True)
        migrated = storage.load('config', 'plugin_runtime_config')
        assert migrated['schema_version'] == 2
        assert migrated['plugins'][0]['activateOnStartup'] is True
        assert storage.load('config_backup', 'plugin_runtime_config_before_v2') == original
        migration.upgrade(backup=True)
        assert storage.load('config', 'plugin_runtime_config') == migrated
        assert storage.load('config_backup', 'plugin_runtime_config_before_v2') == original
    finally:
        storage.close()


def _make_admin_headers(client, email='plugins-admin@example.com'):
    payload = {'email': email, 'pat': 'token'}
    r_acct = client.post('/api/config', json=payload)
    assert r_acct.status_code in (200, 201)

    r_sess = client.post('/api/session', json={'email': email})
    assert r_sess.status_code == 200
    sid = r_sess.json().get('sessionId')
    assert sid

    account_storage = client.app.state.container.get('storage')
    try:
        record = dict(account_storage.load('accounts', email))
    except Exception:
        record = {'email': email}
    record['permissions'] = ['admin']
    account_storage.save('accounts', email, record)

    session_mgr = client.app.state.container.get('session_manager')
    session_mgr._store[sid] = {'email': email, 'pat': 'token'}
    return {'X-Session-Id': sid}


def test_normalize_plugin_runtime_config_single_active_and_disabled_rule():
    payload = {
        'schema_version': 2,
        'plugins': [
            {'id': 'alpha', 'enabled': False, 'activateOnStartup': True, 'custom_config': {'x': 1}},
            {'id': 'beta', 'enabled': True, 'activateOnStartup': True, 'custom_config': {'y': 'ok'}},
            {'id': 'gamma', 'enabled': True, 'activateOnStartup': True, 'custom_config': {'z': [1, 2, 3]}},
        ],
    }

    result = normalize_plugin_runtime_config(payload)

    assert [p['id'] for p in result['plugins']] == ['alpha', 'beta', 'gamma']
    assert result['plugins'][0]['activateOnStartup'] is False
    assert result['plugins'][1]['activateOnStartup'] is True
    assert result['plugins'][2]['activateOnStartup'] is False
    assert result['plugins'][2]['custom_config'] == {'z': [1, 2, 3]}


def test_normalize_plugin_runtime_config_rejects_duplicate_ids():
    payload = {
        'schema_version': 2,
        'plugins': [
            {'id': 'dup', 'enabled': True, 'activateOnStartup': True, 'custom_config': {}},
            {'id': 'dup', 'enabled': True, 'activateOnStartup': False, 'custom_config': {}},
        ],
    }

    with pytest.raises(ValueError, match='duplicate plugin id'):
        normalize_plugin_runtime_config(payload)


def test_admin_plugins_config_get_and_post_persist(client):
    headers = _make_admin_headers(client)

    r_get = client.get('/admin/v1/plugins-config', headers=headers)
    assert r_get.status_code == 200
    assert r_get.json()['content'] == {'schema_version': 2, 'plugins': []}

    payload = {
        'content': {
            'schema_version': 2,
            'plugins': [
                {
                    'id': 'portfolio-board',
                    'enabled': True,
                    'activateOnStartup': True,
                    'custom_config': {
                        'columns': ['Todo', 'Doing', 'Done'],
                        'showTimeline': True,
                    },
                },
                {
                    'id': 'cost-v2',
                    'enabled': True,
                    'activateOnStartup': True,
                    'custom_config': {'currency': 'EUR'},
                },
                {
                    'id': 'sample-menu-plugin',
                    'enabled': True,
                    'activateOnStartup': False,
                    'menuPosition': 'after-tools',
                    'custom_config': {'initialCount': 3},
                },
            ],
        }
    }
    r_post = client.post('/admin/v1/plugins-config', json=payload, headers=headers)
    assert r_post.status_code == 200
    assert r_post.json().get('ok') is True

    r_get_after = client.get('/admin/v1/plugins-config', headers=headers)
    assert r_get_after.status_code == 200
    content = r_get_after.json()['content']
    assert content['schema_version'] == 2
    assert [p['id'] for p in content['plugins']] == ['portfolio-board', 'cost-v2', 'sample-menu-plugin']
    assert content['plugins'][0]['activateOnStartup'] is True
    assert content['plugins'][1]['activateOnStartup'] is False
    assert content['plugins'][0]['custom_config']['columns'] == ['Todo', 'Doing', 'Done']
    assert content['plugins'][2]['menuPosition'] == 'after-tools'
    assert content['plugins'][2]['custom_config'] == {'initialCount': 3}


def test_admin_plugins_config_invalid_payload_returns_400(client):
    headers = _make_admin_headers(client, email='plugins-admin-2@example.com')
    payload = {
        'content': {
            'schema_version': 2,
            'plugins': [
                {'id': 'dup', 'enabled': True, 'activateOnStartup': True, 'custom_config': {}},
                {'id': 'dup', 'enabled': True, 'activateOnStartup': False, 'custom_config': {}},
            ],
        }
    }

    resp = client.post('/admin/v1/plugins-config', json=payload, headers=headers)
    assert resp.status_code == 400
    assert resp.json()['error'] == 'invalid_payload'
    assert 'duplicate plugin id' in resp.json()['message']


def test_runtime_plugins_config_endpoint_returns_persisted_runtime_fields(client):
    headers = _make_admin_headers(client, email='plugins-admin-3@example.com')
    save_payload = {
        'content': {
            'schema_version': 2,
            'plugins': [
                {
                    'id': 'portfolio-board',
                    'enabled': True,
                    'activateOnStartup': True,
                    'custom_config': {'layout': 'dense', 'unknownFlag': {'a': 1}},
                }
            ],
        }
    }
    save_resp = client.post('/admin/v1/plugins-config', json=save_payload, headers=headers)
    assert save_resp.status_code == 200

    runtime_resp = client.get('/api/plugins/config', headers=headers)
    assert runtime_resp.status_code == 200

    body = runtime_resp.json()
    assert set(body.keys()) == {'schema_version', 'plugins'}
    assert body['schema_version'] == 2
    assert len(body['plugins']) == 1
    assert body['plugins'][0]['id'] == 'portfolio-board'
    assert body['plugins'][0]['enabled'] is True
    assert body['plugins'][0]['activateOnStartup'] is True
    assert body['plugins'][0]['custom_config'] == {'layout': 'dense', 'unknownFlag': {'a': 1}}
