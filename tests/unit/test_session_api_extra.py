import pytest


def test_session_post_key_error(client, monkeypatch):
    # Simulate create_session raising KeyError -> 401
    def _create_session(email, request=None):
        raise KeyError('no account')

    monkeypatch.setattr('planner_lib.session.api.create_session', _create_session)

    from fastapi.testclient import TestClient
    tc = TestClient(client.app, raise_server_exceptions=False)
    resp = tc.post('/api/session', json={'email': 'test@example.com'})
    assert resp.status_code == 401


def test_session_post_generic_error(client, monkeypatch):
    # Simulate create_session raising generic exception -> 500
    def _create_session(email, request=None):
        raise RuntimeError('bad')

    monkeypatch.setattr('planner_lib.session.api.create_session', _create_session)

    from fastapi.testclient import TestClient
    tc = TestClient(client.app, raise_server_exceptions=False)
    resp = tc.post('/api/session', json={'email': 'test@example.com'})
    assert resp.status_code == 500
