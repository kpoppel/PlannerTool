import os
import shutil
from planner_lib.storage.file_backend import FileStorageBackend


def setup_module(module):
    # ensure a clean data directory for tests
    if os.path.exists("./data_test"):
        shutil.rmtree("./data_test")


def teardown_module(module):
    if os.path.exists("./data_test"):
        shutil.rmtree("./data_test")


def test_save_load_delete_and_list_keys():
    b = FileStorageBackend(data_dir="./data_test")
    ns = "unittest"
    key = "item1"
    value = {"x": 1}

    b.save(ns, key, value)
    assert b.exists(ns, key) is True
    keys = list(b.list_keys(ns))
    assert key in keys
    loaded = b.load(ns, key)
    assert loaded == value
    b.delete(ns, key)
    assert b.exists(ns, key) is False
