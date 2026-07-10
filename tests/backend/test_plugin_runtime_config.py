import pytest

from planner_lib.admin.plugin_runtime_config import normalize_plugin_runtime_config


def _make_admin_headers(client, email='plugins-admin@example.com'):
    payload = {'email': email, 'pat': 'token'}
    r_acct = client.post('/api/config', json=payload)
    assert r_acct.status_code in (200, 201)

    r_sess = client.post('/api/session', json={'email': email})
    assert r_sess.status_code == 200
    sid = r_sess.json().get('sessionId')
    assert sid

    account_storage = client.app.state.container.get('account_storage')
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
        'schema_version': 1,
        'plugins': [
            {'id': 'alpha', 'enabled': False, 'activated': True, 'custom_config': {'x': 1}},
            {'id': 'beta', 'enabled': True, 'activated': True, 'custom_config': {'y': 'ok'}},
            {'id': 'gamma', 'enabled': True, 'activated': True, 'custom_config': {'z': [1, 2, 3]}},
        ],
    }

    result = normalize_plugin_runtime_config(payload)

    assert [p['id'] for p in result['plugins']] == ['alpha', 'beta', 'gamma']
    assert result['plugins'][0]['activated'] is False
    assert result['plugins'][1]['activated'] is True
    assert result['plugins'][2]['activated'] is False
    assert result['plugins'][2]['custom_config'] == {'z': [1, 2, 3]}


def test_normalize_plugin_runtime_config_rejects_duplicate_ids():
    payload = {
        'schema_version': 1,
        'plugins': [
            {'id': 'dup', 'enabled': True, 'activated': True, 'custom_config': {}},
            {'id': 'dup', 'enabled': True, 'activated': False, 'custom_config': {}},
        ],
    }

    with pytest.raises(ValueError, match='duplicate plugin id'):
        normalize_plugin_runtime_config(payload)


def test_admin_plugins_config_get_and_post_persist(client):
    headers = _make_admin_headers(client)

    r_get = client.get('/admin/v1/plugins-config', headers=headers)
    assert r_get.status_code == 200
    assert r_get.json()['content'] == {'schema_version': 1, 'plugins': []}

    payload = {
        'content': {
            'schema_version': 2,
            'plugins': [
                {
                    'id': 'portfolio-board',
                    'enabled': True,
                    'activated': True,
                    'order': 0,
                    'custom_config': {
                        'columns': ['Todo', 'Doing', 'Done'],
                        'showTimeline': True,
                    },
                },
                {
                    'id': 'cost-v2',
                    'enabled': True,
                    'activated': True,
                    'order': 1,
                    'custom_config': {'currency': 'EUR'},
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
    assert [p['id'] for p in content['plugins']] == ['portfolio-board', 'cost-v2']
    assert content['plugins'][0]['activated'] is True
    assert content['plugins'][1]['activated'] is False
    assert content['plugins'][0]['custom_config']['columns'] == ['Todo', 'Doing', 'Done']


def test_admin_plugins_config_invalid_payload_returns_400(client):
    headers = _make_admin_headers(client, email='plugins-admin-2@example.com')
    payload = {
        'content': {
            'schema_version': 1,
            'plugins': [
                {'id': 'dup', 'enabled': True, 'activated': True, 'custom_config': {}},
                {'id': 'dup', 'enabled': True, 'activated': False, 'custom_config': {}},
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
            'schema_version': 7,
            'plugins': [
                {
                    'id': 'portfolio-board',
                    'enabled': True,
                    'activated': True,
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
    assert body['schema_version'] == 7
    assert len(body['plugins']) == 1
    assert body['plugins'][0]['id'] == 'portfolio-board'
    assert body['plugins'][0]['enabled'] is True
    assert body['plugins'][0]['activated'] is True
    assert body['plugins'][0]['custom_config'] == {'layout': 'dense', 'unknownFlag': {'a': 1}}
