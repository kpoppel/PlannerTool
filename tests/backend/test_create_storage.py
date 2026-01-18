from planner_lib.storage import create_storage


def test_create_storage_dict(tmp_path):
    data_dir = str(tmp_path / "data_dict")
    s = create_storage(serializer='pickle', accessor='dict', data_dir=data_dir)
    s.set_in('ns', 'doc', ['a', 'b'], 123)
    assert s.get_in('ns', 'doc', ['a', 'b']) == 123


def test_create_storage_list(tmp_path):
    data_dir = str(tmp_path / "data_list")
    s = create_storage(serializer='pickle', accessor='list', data_dir=data_dir)
    s.save('ns', 'lst', [0, 1, 2])
    s.set_in('ns', 'lst', [1], 42)
    assert s.get_in('ns', 'lst', [1]) == 42


def test_create_storage_encrypted(tmp_path):
    data_dir = str(tmp_path / "data_enc")
    s = create_storage(serializer='encrypted', password='pw', accessor='dict', data_dir=data_dir)
    s.set_in('ns', 'secret', ['x'], {'foo': 'bar'})
    assert s.get_in('ns', 'secret', ['x']) == {'foo': 'bar'}
from planner_lib.storage import create_storage
import shutil


def test_create_storage_dict(tmp_path):
    data_dir = str(tmp_path / "data_dict")
    s = create_storage(serializer='pickle', accessor='dict', data_dir=data_dir)
    s.set_in('ns', 'doc', ['a', 'b'], 123)
    assert s.get_in('ns', 'doc', ['a', 'b']) == 123
    shutil.rmtree(data_dir)


def test_create_storage_list(tmp_path):
    data_dir = str(tmp_path / "data_list")
    s = create_storage(serializer='pickle', accessor='list', data_dir=data_dir)
    s.save('ns', 'lst', [0, 1, 2])
    s.set_in('ns', 'lst', [1], 42)
    assert s.get_in('ns', 'lst', [1]) == 42
    shutil.rmtree(data_dir)


def test_create_storage_encrypted(tmp_path):
    data_dir = str(tmp_path / "data_enc")
    s = create_storage(serializer='encrypted', password='pw', accessor='dict', data_dir=data_dir)
    s.set_in('ns', 'secret', ['x'], {'foo': 'bar'})
    assert s.get_in('ns', 'secret', ['x']) == {'foo': 'bar'}
    shutil.rmtree(data_dir)
