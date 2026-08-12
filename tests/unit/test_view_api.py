def test_view_get_returns_meta_id_after_save_with_null_id(client):
    headers = {'X-Session-Id': 'test-session'}

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


def test_view_save_accepts_meta_id_from_loaded_payload(client):
    headers = {'X-Session-Id': 'test-session'}

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
