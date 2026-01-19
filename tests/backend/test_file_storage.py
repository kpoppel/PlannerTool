import os
import shutil
from planner_lib.storage import create_storage


def test_save_load_delete_and_list_keys(tmp_path):
    data_dir = str(tmp_path / "data_test")
    # ensure a clean directory
    if os.path.exists(data_dir):
        shutil.rmtree(data_dir)
    b = create_storage(backend='file', serializer='pickle', accessor='dict', data_dir=data_dir)
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
