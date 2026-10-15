from planner_lib.storage.memory_backend import MemoryStorage
from concurrent.futures import ThreadPoolExecutor

import pytest


def test_memory_transaction_rolls_back_mutations_and_insertions() -> None:
    storage = MemoryStorage()
    storage.save('config', 'teams', {'names': ['Original']})
    with pytest.raises(RuntimeError, match='rollback'):
        with storage.transaction():
            storage.load('config', 'teams')['names'].append('Changed')
            storage.save('config', 'workforce', {'staffing': []})
            storage.set('top-level', 'changed')
            raise RuntimeError('rollback')
    assert storage.load('config', 'teams') == {'names': ['Original']}
    assert not storage.exists('config', 'workforce')
    assert storage.get('top-level') is None


def test_memory_transactions_are_nested_and_serialize_writers() -> None:
    storage = MemoryStorage()
    storage.save('config', 'counter', 0)

    def increment(index: int) -> None:
        with storage.transaction():
            value = storage.load('config', 'counter')
            with storage.transaction():
                storage.save('config', 'counter', value + 1)

    with ThreadPoolExecutor(max_workers=8) as workers:
        list(workers.map(increment, range(40)))
    assert storage.load('config', 'counter') == 40

    with storage.transaction():
        with pytest.raises(ValueError):
            with storage.transaction():
                storage.delete('config', 'counter')
                raise ValueError('inner rollback')
        assert storage.load('config', 'counter') == 40
        storage.save('config', 'counter', 41)
    assert storage.load('config', 'counter') == 41


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

