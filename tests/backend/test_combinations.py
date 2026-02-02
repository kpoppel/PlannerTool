import pytest
from planner_lib.storage import create_storage
from cryptography.fernet import Fernet


@pytest.mark.parametrize("serializer,accessor", [
    ("pickle", "dict"),
    ("pickle", "list"),
    ("pickle", None),
    ("json", "dict"),
    ("json", None),
    ("yaml", "dict"),
    ("yaml", None),
])
def test_serializer_accessor_basic(tmp_path, serializer, accessor):
    data_dir = str(tmp_path / f"data_{serializer}_{accessor}")
    s = create_storage(backend='memory', serializer=serializer, accessor=accessor)

    # When accessor is None, we operate at object level
    if accessor is None:
        s.save("ns", "k", {"a": 1})
        val = s.load("ns", "k")
        assert isinstance(val, dict)
        assert val["a"] == 1
    else:
        # dict accessor: nested mapping
        if accessor == "dict":
            s.set_in("ns", "doc", ["a", "b"], 10)
            assert s.get_in("ns", "doc", ["a", "b"]) == 10
        else:
            # list accessor: ensure saving a list then updating index
            s.save("ns", "lst", [0, 1, 2])
            s.set_in("ns", "lst", [1], 99)
            assert s.get_in("ns", "lst", [1]) == 99


def test_encrypted_password_and_key_modes(tmp_path):
    data_dir_pw = str(tmp_path / "data_enc_pw")
    s_pw = create_storage(backend='memory', serializer="encrypted", password="pwtest", accessor="dict")
    s_pw.set_in("ns", "secret", ["x"], {"foo": "bar"})
    assert s_pw.get_in("ns", "secret", ["x"]) == {"foo": "bar"}

    # key mode
    key = Fernet.generate_key()
    data_dir_key = str(tmp_path / "data_enc_key")
    s_key = create_storage(backend='memory', serializer="encrypted", key=key, accessor="dict")
    s_key.set_in("ns", "secret", ["x"], {"n": 1})
    assert s_key.get_in("ns", "secret", ["x"]) == {"n": 1}
