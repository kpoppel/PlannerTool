import tempfile
from planner_lib.storage import create_storage
import pytest


def test_value_navigating_set_get_delete(tmp_path):
    data_dir = str(tmp_path / "data_vns")
    vns = create_storage(backend='memory', serializer='pickle', accessor='dict')

    ns = "vnstest"
    key = "doc1"

    # set_in should create container and set nested value
    vns.set_in(ns, key, ["a", "b"], 123)
    got = vns.get_in(ns, key, ["a", "b"])
    assert got == 123

    # update nested value
    vns.set_in(ns, key, ["a", "c"], {"x": 5})
    assert vns.get_in(ns, key, ["a", "c"]) == {"x": 5}

    # delete nested value
    vns.delete_in(ns, key, ["a", "b"])
    with pytest.raises(KeyError):
        vns.get_in(ns, key, ["a", "b"])
