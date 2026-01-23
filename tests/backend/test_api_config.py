import os
import shutil
import tempfile

from fastapi.testclient import TestClient

import planner
import planner_lib.accounts.config as config_mod
from planner_lib.storage import create_storage


TMP_DATA_DIR = ""


def setup_module(module):
    # create an isolated temporary data dir and assign the config module storage to it
    global TMP_DATA_DIR
    TMP_DATA_DIR = tempfile.mkdtemp(prefix="plannertool-test-data-")
    # ensure clean
    if os.path.exists(TMP_DATA_DIR):
        shutil.rmtree(TMP_DATA_DIR)
    fb = create_storage(backend='file', serializer='pickle', accessor='dict', data_dir=TMP_DATA_DIR)
    # assign module-level storage so account_manager uses the test backend
    config_mod._storage = fb


def teardown_module(module):
    global TMP_DATA_DIR
    if TMP_DATA_DIR and os.path.exists(TMP_DATA_DIR):
        shutil.rmtree(TMP_DATA_DIR)


def test_post_config_and_persistence():
    client = TestClient(planner.app)
    payload = { 'email': 'tester@example.com', 'pat': 'secrettoken' }
    resp = client.post('/api/account', json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body.get('ok') is True
    # verify config can be loaded via the storage API
    stored = config_mod._storage.load('accounts', 'tester@example.com')
    assert stored['email'] == payload['email']
    assert stored['pat'] == payload['pat']
