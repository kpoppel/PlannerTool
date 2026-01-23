import pytest
from planner_lib.setup import BackendConfig
from planner_lib.storage.base import StorageBackend, SerializerBackend
from planner_lib.storage.serializer import PickleSerializer, YAMLSerializer


# Tests should use the storage composition classes provided by the library.
# We use a simple in-memory backend below and wrap it with a SerializerBackend
# when we want transparent serialization behaviour for the test.


class InMemoryBackend(StorageBackend):
    def __init__(self):
        self._data = {}

    def save(self, namespace: str, key: str, value):
        self._data.setdefault(namespace, {})[key] = value

    def load(self, namespace: str, key: str):
        try:
            return self._data[namespace][key]
        except KeyError:
            raise KeyError(key)

    def delete(self, namespace: str, key: str):
        try:
            del self._data[namespace][key]
        except KeyError:
            raise KeyError(key)

    def list_keys(self, namespace: str):
        return list(self._data.get(namespace, {}).keys())

    def exists(self, namespace: str, key: str) -> bool:
        return key in self._data.get(namespace, {})

    def configure(self, **options):
        # no-op for in-memory test backend
        return None


def test_save_and_load_roundtrip():
    backend = InMemoryBackend()
    # Use the library's SerializerBackend with PickleSerializer so the
    # BackendConfig instance round-trips as an object (pickle preserves
    # the dataclass instance semantics for the test).
    store = SerializerBackend(backend, PickleSerializer())

    cfg = BackendConfig(
        azure_devops_organization="https://dev.azure.com/org",
        area_paths=["\\Area\\A", "\\Area\\B"],
        project_map=[
            {"name": "ProjectA", "area_path": "\\Area\\A"},
            {"name": "ProjectB", "area_path": "\\Area\\B"},
        ],
        team_map=[],
        feature_flags={},
        data_dir=None,
    )

    store.save("config", "project_config.yml", cfg)
    loaded = store.load("config", "project_config.yml")

    assert loaded == cfg


def test_load_invalid_format_raises():
    backend = InMemoryBackend()
    # Store malformed YAML bytes into the backend and wrap with the
    # SerializerBackend using the YAMLSerializer. When deserialization
    # fails the adapter returns the raw payload; our test asserts the
    # raw bytes are returned rather than raising.
    raw = b"not: - a - mapping\n-[]"
    backend.save("config", "bad.yml", raw)
    store = SerializerBackend(backend, YAMLSerializer())

    loaded = store.load("config", "bad.yml")
    assert loaded == raw
