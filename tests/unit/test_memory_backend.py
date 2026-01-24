from planner_lib.storage.memory_backend import MemoryStorage


def test_memory_basic_operations():
    m = MemoryStorage()

    # set/get
    m.set('k', 'v')
    assert m.get('k') == 'v'

    # delete
    m.delete('k')
    assert m.get('k') is None

    # namespace save/load
    m.save('ns', 'a', {'x': 1})
    assert m.load('ns', 'a') == {'x': 1}

    # exists and list_keys
    assert m.exists('ns', 'a') is True
    keys = list(m.list_keys('ns'))
    assert 'a' in keys

    # configure is a no-op
    assert m.configure(foo='bar') is None

