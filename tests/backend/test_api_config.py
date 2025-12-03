import os
import shutil
import pickle
from pathlib import Path

from fastapi.testclient import TestClient

import planner


def setup_module(module):
    # ensure clean data dir
    if os.path.exists('./data'):
        shutil.rmtree('./data')


def teardown_module(module):
    if os.path.exists('./data'):
        shutil.rmtree('./data')


def test_post_config_and_persistence():
    client = TestClient(planner.app)
    payload = { 'email': 'tester@example.com', 'pat': 'secrettoken' }
    resp = client.post('/api/config', json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body.get('ok') is True
    # verify file stored under ./data/config/tester@example.com.pkl
    p = Path('./data') / 'config' / 'tester@example.com.pkl'
    assert p.exists()
    with p.open('rb') as f:
        stored = pickle.load(f)
    assert stored['email'] == payload['email']
    assert stored['pat'] == payload['pat']
