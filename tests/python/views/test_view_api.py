import pytest

from planner_lib.middleware.session import SessionManager, get_session_id_from_request


REAL_CREATE = SessionManager.create
REAL_GET = SessionManager.get
REAL_EXISTS = SessionManager.exists
REAL_SESSION_ID = get_session_id_from_request


@pytest.fixture
def authenticated_client(client, monkeypatch):
    monkeypatch.setattr(SessionManager, 'create', REAL_CREATE)
    monkeypatch.setattr(SessionManager, 'get', REAL_GET)
    monkeypatch.setattr(SessionManager, 'exists', REAL_EXISTS)
    monkeypatch.setattr('planner_lib.middleware.session.get_session_id_from_request', REAL_SESSION_ID)
    assert client.post('/api/auth/enroll', json={
        'email': 'view-owner@example.com', 'name': 'View Owner',
    }).status_code == 200
    return client


@pytest.mark.parametrize('endpoint, namespace', [
    ('view', 'views'),
    ('scenario', 'scenarios'),
])
def test_user_data_is_owned_by_account_id_after_delete_and_reenroll(
    client, monkeypatch, endpoint, namespace,
):
    monkeypatch.setattr(SessionManager, 'create', REAL_CREATE)
    monkeypatch.setattr(SessionManager, 'get', REAL_GET)
    monkeypatch.setattr(SessionManager, 'exists', REAL_EXISTS)
    monkeypatch.setattr('planner_lib.middleware.session.get_session_id_from_request', REAL_SESSION_ID)
    enrollment = {'email': 'owner@example.com', 'name': 'Original Owner'}
    assert client.post('/api/auth/enroll', json=enrollment).status_code == 200
    accounts = client.app.state.container.get('account_manager')
    storage = client.app.state.container.get('storage')
    original_id = accounts.get_account_id(enrollment['email'])
    accounts.set_permissions(original_id, [])
    data = {
        'name': 'Private data', 'overrides': {}, 'filters': {}, 'view': {},
        'groupOverrides': {}, 'scenarioGroups': [], 'pluginData': {},
    }
    saved = client.post('/api/' + endpoint, json={'op': 'save', 'data': data})
    assert saved.status_code == 200
    item_id = saved.json()['id']
    assert saved.json()['user'] == original_id
    assert storage.exists(namespace, original_id + '_' + item_id)
    assert client.get('/api/' + endpoint + '?id=' + item_id).status_code == 200

    accounts.delete_account(original_id)
    assert client.post('/api/auth/enroll', json={**enrollment, 'name': 'New Owner'}).status_code == 200
    assert accounts.get_account_id(enrollment['email']) != original_id
    assert client.get('/api/' + endpoint).json() == []
    assert client.get('/api/' + endpoint + '?id=' + item_id).status_code == 404


def test_view_get_returns_meta_id_after_save_with_null_id(authenticated_client):
    client = authenticated_client
    headers = {'Accept': 'application/json'}

    save_resp = client.post(
        '/api/view',
        headers=headers,
        json={'op': 'save', 'data': {'id': None, 'name': 'Bluetooth', 'viewOptions': {}}},
    )
    assert save_resp.status_code == 200
    saved = save_resp.json()
    assert saved.get('id')

    get_resp = client.get(f"/api/view?id={saved['id']}", headers=headers)
    assert get_resp.status_code == 200
    payload = get_resp.json()

    assert payload.get('id') is None
    assert payload.get('_meta', {}).get('id') == saved['id']
    assert payload.get('name') == 'Bluetooth'


def test_view_save_accepts_meta_id_from_loaded_payload(authenticated_client):
    client = authenticated_client
    headers = {'Accept': 'application/json'}

    save_resp = client.post(
        '/api/view',
        headers=headers,
        json={'op': 'save', 'data': {'id': None, 'name': 'Bluetooth', 'viewOptions': {}}},
    )
    saved = save_resp.json()

    get_resp = client.get(f"/api/view?id={saved['id']}", headers=headers)
    payload = get_resp.json()
    payload['name'] = 'Bluetooth Renamed'

    rename_resp = client.post('/api/view', headers=headers, json={'op': 'save', 'data': payload})
    assert rename_resp.status_code == 200
    assert rename_resp.json()['id'] == saved['id']

    verify_resp = client.get(f"/api/view?id={saved['id']}", headers=headers)
    assert verify_resp.status_code == 200
    assert verify_resp.json()['name'] == 'Bluetooth Renamed'
    assert verify_resp.json().get('_meta', {}).get('id') == saved['id']
