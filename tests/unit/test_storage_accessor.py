import pytest

from planner_lib.storage.accessor import DictAccessor, ListAccessor, MixedAccessor, AccessorView, StorageProxy
from typing import MutableMapping


def test_dict_accessor_basic():
    d = DictAccessor()
    data = {}
    d.set(data, ('a', 'b'), 1)
    assert data['a']['b'] == 1
    assert d.get(data, ('a', 'b')) == 1
    d.delete(data, ('a', 'b'))
    with pytest.raises(KeyError):
        d.get(data, ('a', 'b'))


def test_list_accessor_basic():
    l = ListAccessor()
    data = [[1, 2], [3, 4]]
    assert l.get(data, (0, 1)) == 2
    l.set(data, (1, 1), 40)
    assert data[1][1] == 40
    l.delete(data, (0, 1))
    assert data[0] == [1]


def test_mixed_accessor_get_set_delete():
    m = MixedAccessor()
    data = {'a': [{'b': 1}]}
    # get
    assert m.get(data, ('a', 0, 'b')) == 1
    # set
    m.set(data, ('a', 0, 'b'), 2)
    assert data['a'][0]['b'] == 2
    # delete
    m.delete(data, ('a', 0, 'b'))
    assert 'b' not in data['a'][0]


def test_mixed_accessor_set_type_error():
    m = MixedAccessor()
    data = [1, 2, 3]
    with pytest.raises(TypeError):
        m.set(data, ('x', 'y'), 5)


def test_accessor_view_and_storage_proxy():
    storage = {}
    view = StorageProxy(storage, 'ns', 'key')
    # set nested value via views
    view['a']['b'] = 10
    assert storage['ns']['key']['a']['b'] == 10
    # get
    assert view['a']['b'].get() == 10
    # set via view.set
    view['a']['c'].set(20)
    assert storage['ns']['key']['a']['c'] == 20
    # delete
    del view['a']['b']
    assert 'b' not in storage['ns']['key']['a']
