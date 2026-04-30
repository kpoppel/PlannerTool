"""TDD tests for CacheManager LoD fix.

The CacheManager (planner_lib.storage.caching) must expose public
accessors so callers never reach through internal attributes.

1. CacheManager.fetch_count is a public readable/writable property.
2. CacheManager.list_area_keys() exposes area-path keys without exposing _read_index().
"""
from types import SimpleNamespace
import pytest


# ---------------------------------------------------------------------------
# CacheManager public fetch_count property
# ---------------------------------------------------------------------------

class TestCacheManagerFetchCount:
    def test_fetch_count_public_property_read(self):
        """CacheManager.fetch_count is a public readable property."""
        from planner_lib.storage.caching import CacheManager

        class FakeStorage:
            def load(self, ns, key):
                raise KeyError(key)
            def save(self, ns, key, value):
                pass
            def exists(self, ns, key):
                return False

        cm = CacheManager(FakeStorage())
        # must not raise; must return 0 by default
        assert cm.fetch_count == 0

    def test_fetch_count_public_property_write(self):
        """CacheManager.fetch_count can be set via public property."""
        from planner_lib.storage.caching import CacheManager

        class FakeStorage:
            def load(self, ns, key):
                raise KeyError(key)
            def save(self, ns, key, value):
                pass
            def exists(self, ns, key):
                return False

        cm = CacheManager(FakeStorage())
        cm.fetch_count = 42
        assert cm.fetch_count == 42

    def test_private_fetch_count_uses_public_property(self):
        """CacheManager.fetch_count is the public accessor — direct _fetch_count access is not needed."""
        from planner_lib.storage.caching import CacheManager

        class FakeStorage:
            def load(self, ns, key):
                raise KeyError(key)
            def save(self, ns, key, value):
                pass
            def exists(self, ns, key):
                return False
            def delete(self, ns, key):
                pass
            def list_keys(self, ns):
                return []

        cm = CacheManager(FakeStorage())
        cm.fetch_count = 5
        assert cm.fetch_count == 5
        cm.fetch_count = 10
        assert cm.fetch_count == 10


# ---------------------------------------------------------------------------
# CacheManager.list_area_keys() public method
# ---------------------------------------------------------------------------

class TestCacheManagerListAreaKeys:
    def _make_cm(self, index_data):
        from planner_lib.storage.caching import CacheManager

        class FakeStorage:
            def __init__(self, idx):
                self._idx = idx
            def load(self, ns, key):
                if key == '_index':
                    return self._idx
                raise KeyError(key)
            def save(self, ns, key, value):
                pass
            def exists(self, ns, key):
                return False

        return CacheManager(FakeStorage(index_data))

    def test_list_area_keys_excludes_special_keys(self):
        """list_area_keys() returns index keys excluding '_invalidated' and
        prefixed history/plan/teams/iterations keys."""
        cm = self._make_cm({
            'area_proj__teamA': {'last_update': '2020-01-01'},
            'area_proj__teamB': {'last_update': '2020-01-01'},
            '_invalidated': {},
            'teams_proj': {},
            'plans_proj': {},
            'history_123': {},
        })
        keys = list(cm.list_area_keys())
        assert 'area_proj__teamA' in keys
        assert 'area_proj__teamB' in keys
        assert '_invalidated' not in keys
        assert 'history_123' not in keys
        assert 'teams_proj' not in keys
        assert 'plans_proj' not in keys

    def test_list_area_keys_empty_index(self):
        cm = self._make_cm({})
        assert list(cm.list_area_keys()) == []

    def test_list_all_index_keys_returns_everything(self):
        """list_all_index_keys() returns every key in the index (for _read_index callers)."""
        cm = self._make_cm({'a': {}, 'b': {}, '_invalidated': {}})
        all_keys = set(cm.list_all_index_keys())
        assert 'a' in all_keys
        assert 'b' in all_keys
        assert '_invalidated' in all_keys
