import os
import uuid
import asyncio
from types import SimpleNamespace
from pathlib import Path
import pytest

from planner_lib.scenarios import scenario_store as ss


SCENARIO_DEFAULTS = {
    'overrides': {},
    'filters': {},
    'view': {},
    'groupOverrides': {},
    'scenarioGroups': [],
    'pluginData': {},
}


class InMemoryBackend:
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
    assert got == {'a': 1, '_meta': {'id': '1'}, **SCENARIO_DEFAULTS}


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
