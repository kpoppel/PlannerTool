"""Simple file-backed storage backend using pickle.

This backend stores pickled Python objects under `./data/<namespace>/<key>.pkl`.
It provides atomic writes by writing to a temporary file then renaming.
"""
from __future__ import annotations
import os
import pickle
from pathlib import Path
from typing import Any, Iterable

from .base import StorageBackend


class FileStorageBackend(StorageBackend):
    def __init__(self, data_dir: str | Path = "./data") -> None:
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def _ns_dir(self, namespace: str) -> Path:
        ns = self.data_dir / namespace
        ns.mkdir(parents=True, exist_ok=True)
        return ns

    def _path_for(self, namespace: str, key: str) -> Path:
        safe_key = key.replace("/", "_")
        return self._ns_dir(namespace) / f"{safe_key}.pkl"

    def save(self, namespace: str, key: str, value: Any) -> None:
        path = self._path_for(namespace, key)
        tmp = path.with_suffix(path.suffix + ".tmp")
        with open(tmp, "wb") as f:
            pickle.dump(value, f)
            f.flush()
            os.fsync(f.fileno())
        tmp.replace(path)

    def load(self, namespace: str, key: str) -> Any:
        path = self._path_for(namespace, key)
        if not path.exists():
            raise KeyError(key)
        with open(path, "rb") as f:
            return pickle.load(f)

    def delete(self, namespace: str, key: str) -> None:
        path = self._path_for(namespace, key)
        if not path.exists():
            raise KeyError(key)
        path.unlink()

    def list_keys(self, namespace: str) -> Iterable[str]:
        ns = self._ns_dir(namespace)
        for p in ns.iterdir():
            if p.is_file() and p.suffix == ".pkl":
                yield p.stem

    def exists(self, namespace: str, key: str) -> bool:
        return self._path_for(namespace, key).exists()
