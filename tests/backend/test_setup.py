import pytest
from planner_lib.setup import BackendConfig, YamlConfigStore
from planner_lib.storage.base import StorageBackend


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
    store = YamlConfigStore(backend)

    cfg = BackendConfig(
        azure_devops_url="https://dev.azure.com/org",
        root_area_path="\\Area",
        area_paths=["\\Area\\A", "\\Area\\B"],
        area_to_project={"\\Area\\A": "ProjectA", "\\Area\\B": "ProjectB"},
    )

    store.save("project_config.yml", cfg)
    loaded = store.load("project_config.yml")

    assert loaded == cfg


def test_load_invalid_format_raises():
    backend = InMemoryBackend()
    backend.save("config", "bad.yml", "not: - a - mapping\n-[]")
    store = YamlConfigStore(backend)

    with pytest.raises(ValueError):
        store.load("bad.yml")
