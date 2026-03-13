from planner_lib.storage.memory_backend import MemoryStorage


def test_memory_basic_operations():
    m = MemoryStorage()

    # set/get
    m.set('k', 'v')
    assert m.get('k') == 'v'

    # namespace save/load
    m.save('ns', 'a', {'x': 1})
    assert m.load('ns', 'a') == {'x': 1}

    # delete namespaced entry
    m.delete('ns', 'a')
    assert m.exists('ns', 'a') is False
    keys = list(m.list_keys('ns'))
    assert 'a' not in keys

    # configure is a no-op
    assert m.configure(foo='bar') is None

