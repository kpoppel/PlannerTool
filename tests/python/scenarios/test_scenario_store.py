import os
import uuid
import asyncio
from types import SimpleNamespace
from pathlib import Path
import pytest
from contextlib import contextmanager
from copy import deepcopy

from planner_lib.scenarios import scenario_store as ss
from planner_lib.storage.memory_backend import MemoryStorage
from planner_lib.domain.scenarios import scenario_access


SCENARIO_DEFAULTS = {
    'overrides': {},
    'filters': {},
    'view': {},
    'groupOverrides': {},
    'scenarioGroups': [],
    'pluginData': {},
}


def test_scenario_ownership_never_grants_nonowner_editing():
    assert scenario_access('reader', 'owner', 'shared', False) == {
        'canEdit': False, 'reason': 'not-owner',
    }
    assert scenario_access('admin', 'owner', 'shared', False)['canEdit'] is False
    assert scenario_access('owner', 'owner', 'shared', False)['canEdit'] is True
    assert scenario_access('owner', 'owner', 'shared', True)['canEdit'] is False


def test_stored_readonly_cannot_be_overwritten_or_deleted(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    storage = MemoryStorage()
    protected = {'id': 'locked', 'name': 'Locked', 'readonly': True, **SCENARIO_DEFAULTS}
    storage.save('scenarios', 'owner_locked', protected)
    for supplied in [{}, {'readonly': False}, {'access': {'canEdit': True, 'reason': None}}]:
        with pytest.raises(PermissionError):
            ss.save_user_scenario(storage, 'owner', 'locked', {'name': 'Changed', **supplied})
        assert storage.load('scenarios', 'owner_locked') == protected
    with pytest.raises(PermissionError):
        ss.delete_user_scenario(storage, 'owner', 'locked')


def test_baseline_is_reserved_and_access_metadata_is_not_persisted(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    storage = MemoryStorage()
    with pytest.raises(PermissionError):
        ss.save_user_scenario(storage, 'owner', 'baseline', {'name': 'No'})
    with pytest.raises(PermissionError):
        ss.delete_user_scenario(storage, 'owner', 'baseline')
    meta = ss.save_user_scenario(storage, 'owner', 'editable', {
        'name': 'Owned', 'access': {'canEdit': False}, 'user': 'intruder',
    })
    assert meta['access'] == {'canEdit': True, 'reason': None}
    assert meta['user'] == 'owner'
    raw = storage.load('scenarios', 'owner_editable')
    assert 'access' not in raw and 'user' not in raw
    assert ss.load_user_scenario(storage, 'owner', 'editable')['access'] == meta['access']
    assert ss.list_user_scenarios(storage, 'owner')[0]['access'] == meta['access']


class InMemoryBackend:
    @contextmanager
    def transaction(self):
        before = deepcopy(self.store)
        try:
            yield
        except Exception:
            self.store = before
            raise

    def __init__(self):
        self.store = {}
        self.backendsaved = []
    def save(self, namespace, key, value, ttl_seconds=None):
        self.store[(namespace, key)] = value
    def load(self, namespace, key):
        k = (namespace, key)
        if k not in self.store:
            raise KeyError(key)
        return self.store[k]
    def delete(self, namespace, key):
        k = (namespace, key)
        if k not in self.store:
            raise KeyError(key)
        del self.store[k]
    def list_keys(self, namespace):
        return [key for (ns, key) in self.store.keys() if ns == namespace]
    def exists(self, namespace, key):
        return (namespace, key) in self.store
    def configure(self, **options):
        pass


def test_scenario_key_format():
    assert ss._scenario_key('u', 's') == 'u_s'


def test_load_register_missing_returns_empty():
    b = InMemoryBackend()
    # no register key -> load should return {}
    reg = ss.load_scenario_register(b)
    assert reg == {}


def test_save_and_load_register():
    b = InMemoryBackend()
    register = {'u_1': {'id': '1'}}
    ss.save_scenario_register(b, register)
    got = ss.load_scenario_register(b)
    assert got == register


def test_save_user_scenario_updates_register_and_returns_meta(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    b = InMemoryBackend()
    meta = ss.save_user_scenario(b, 'userA', None, {'foo': 'bar'})
    assert 'id' in meta and meta['user'] == 'userA'
    # stored scenario key present
    key = ss._scenario_key('userA', meta['id'])
    assert b.load(ss.SCENARIO_NS, key) == {'foo': 'bar', **SCENARIO_DEFAULTS}
    reg = ss.load_scenario_register(b)
    assert key in reg


def test_load_user_scenario_reads_value():
    b = InMemoryBackend()
    b.save(ss.SCENARIO_NS, 'u_1', {'a': 1})
    got = ss.load_user_scenario(b, 'u', '1')
    assert got == {'a': 1, '_meta': {'id': '1'},
                   'access': {'canEdit': True, 'reason': None}, **SCENARIO_DEFAULTS}


def test_save_user_scenario_overrides_null_id(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    b = InMemoryBackend()
    meta = ss.save_user_scenario(b, 'userA', None, {'id': None, 'name': 'Scenario A'})
    got = ss.load_user_scenario(b, 'userA', meta['id'])
    assert got['_meta']['id'] == meta['id']
    assert got['name'] == 'Scenario A'


def test_save_user_scenario_strips_storage_metadata_from_raw_blob(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    b = InMemoryBackend()
    meta = ss.save_user_scenario(
        b,
        'userA',
        None,
        {'id': 'transient', '_meta': {'id': 'old'}, 'name': 'Scenario A'},
    )
    raw = b.load(ss.SCENARIO_NS, ss._scenario_key('userA', meta['id']))
    assert raw == {
        'id': 'transient',
        'name': 'Scenario A',
        **SCENARIO_DEFAULTS,
    }


def test_load_user_scenario_preserves_domain_id_and_adds_storage_meta():
    b = InMemoryBackend()
    b.save(ss.SCENARIO_NS, 'u_1', {'id': 'domain-7', 'name': 'Scenario A'})
    got = ss.load_user_scenario(b, 'u', '1')
    assert got['id'] == 'domain-7'
    assert got['_meta']['id'] == '1'


def test_acceptance_only_scenario_round_trip_stays_user_scoped(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    backend = InMemoryBackend()
    decision = {
        'id': 'containment:child:parent',
        'identity': {'rule': 'containment', 'taskId': 'child', 'relatedId': 'parent',
                     'path': ['child', 'parent']},
        'actor': 'editor@example.test',
        'acceptedAt': '2026-10-05T12:00:00Z',
        'reason': 'Agreed delivery window',
        'evidence': 'cached-task-and-scenario-evidence',
        'status': 'active',
    }
    payload = {'name': 'What-if', 'overrides': {}, 'pluginData': {
        'plugin-reconciliation': {'version': 1, 'decisions': [decision]},
    }}
    meta = ss.save_user_scenario(backend, 'editor@example.test', None, payload)
    loaded = ss.load_user_scenario(backend, 'editor@example.test', meta['id'])
    assert loaded['overrides'] == {}
    assert loaded['pluginData'] == payload['pluginData']
    assert meta['shared'] is False
    assert ss.list_user_scenarios(backend, 'other@example.test') == []
    assert {namespace for namespace, _ in backend.store} == {ss.SCENARIO_NS}


def test_delete_user_scenario_success_and_failure(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    b = InMemoryBackend()
    # save scenario and register
    b.save(ss.SCENARIO_NS, 'userX_abc', {'x': 1})
    ss.save_scenario_register(b, {'userX_abc': {'id': 'abc', 'user': 'userX'}})
    # delete existing
    ok = ss.delete_user_scenario(b, 'userX', 'abc')
    assert ok is True
    # now delete non-existent
    ok2 = ss.delete_user_scenario(b, 'userX', 'missing')
    assert ok2 is False


def test_list_user_scenarios_filters():
    b = InMemoryBackend()
    b.save(ss.SCENARIO_NS, 'u1_1', {'id': '1'})
    b.save(ss.SCENARIO_NS, 'u2_1', {'id': '1'})
    ss.save_scenario_register(b, {'u1_1': {'id': '1'}, 'u2_1': {'id': '1'}})
    res = ss.list_user_scenarios(b, 'u1')
    assert isinstance(res, list) and len(res) == 1
