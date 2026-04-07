"""Tests for AzureProjectMetadataService."""
import pytest


# ---------------------------------------------------------------------------
# Fake disk cache (in-memory for testing)
# ---------------------------------------------------------------------------

class FakeDiskCache:
    def __init__(self):
        self._store = {}

    def _key(self, namespace, key):
        return f"{namespace}::{key}"

    def save(self, namespace, key, value):
        self._store[self._key(namespace, key)] = value

    def load(self, namespace, key):
        k = self._key(namespace, key)
        if k not in self._store:
            raise KeyError(key)
        return self._store[k]

    def exists(self, namespace, key):
        return self._key(namespace, key) in self._store


# ---------------------------------------------------------------------------
# Fake Azure service
# ---------------------------------------------------------------------------

from contextlib import contextmanager


class FakeAzureClient:
    def __init__(self, metadata):
        self._metadata = metadata
        self.call_count = 0

    def get_area_path_used_metadata(self, project, area_path):
        self.call_count += 1
        return self._metadata


class FakeAzureService:
    def __init__(self, inner_client):
        self._inner = inner_client

    @contextmanager
    def connect(self, pat):
        yield self._inner


# ---------------------------------------------------------------------------
# Import under test
# ---------------------------------------------------------------------------

from planner_lib.projects.metadata_service import AzureProjectMetadataService


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def _make_metadata():
    return {
        'types': ['Bug', 'Feature'],
        'states': ['Active', 'New', 'Closed'],
        'states_by_type': {'Bug': ['Active', 'New', 'Closed'], 'Feature': ['Active', 'New']},
        'state_categories': {'Active': 'InProgress', 'New': 'Proposed', 'Closed': 'Completed'},
    }


def test_get_cached_returns_none_when_empty():
    svc = AzureProjectMetadataService(cache=FakeDiskCache())
    assert svc.get_cached('ProjectA') is None


def test_store_and_get_cached_round_trips():
    cache = FakeDiskCache()
    svc = AzureProjectMetadataService(cache=cache)
    meta = _make_metadata()
    svc.store('ProjectA', meta)
    result = svc.get_cached('ProjectA')
    assert result == meta


def test_get_or_fetch_hits_cache_on_second_call():
    cache = FakeDiskCache()
    meta = _make_metadata()
    inner = FakeAzureClient(meta)
    azure_svc = FakeAzureService(inner)
    svc = AzureProjectMetadataService(cache=cache)

    # First call — cache miss, should call Azure
    r1 = svc.get_or_fetch('ProjectA', 'ProjectA\\Team1', 'pat', azure_svc)
    assert r1 == meta
    assert inner.call_count == 1

    # Second call — cache hit, Azure should NOT be called again
    r2 = svc.get_or_fetch('ProjectA', 'ProjectA\\Team1', 'pat', azure_svc)
    assert r2 == meta
    assert inner.call_count == 1  # still 1


def test_get_or_fetch_stores_fetched_data():
    cache = FakeDiskCache()
    meta = _make_metadata()
    inner = FakeAzureClient(meta)
    azure_svc = FakeAzureService(inner)
    svc = AzureProjectMetadataService(cache=cache)

    svc.get_or_fetch('ProjectA', 'ProjectA\\Team1', 'pat', azure_svc)
    assert cache.exists('azure_project_metadata', 'ProjectA')


def test_get_or_fetch_returns_state_categories():
    cache = FakeDiskCache()
    meta = _make_metadata()
    inner = FakeAzureClient(meta)
    azure_svc = FakeAzureService(inner)
    svc = AzureProjectMetadataService(cache=cache)

    result = svc.get_or_fetch('ProjectA', 'ProjectA\\Team1', 'pat', azure_svc)
    assert 'state_categories' in result
    assert result['state_categories']['Active'] == 'InProgress'
    assert result['state_categories']['New'] == 'Proposed'
    assert result['state_categories']['Closed'] == 'Completed'


def test_different_projects_cached_independently():
    cache = FakeDiskCache()
    meta_a = {**_make_metadata(), 'types': ['Bug']}
    meta_b = {**_make_metadata(), 'types': ['Epic']}
    svc = AzureProjectMetadataService(cache=cache)

    svc.store('ProjectA', meta_a)
    svc.store('ProjectB', meta_b)

    assert svc.get_cached('ProjectA')['types'] == ['Bug']
    assert svc.get_cached('ProjectB')['types'] == ['Epic']
