"""Simple memory-backed storage backend

This backend stores Python objects in memory as a data structure `[<namespace>][<key>]`.
Inherits from StorageBackend so it satisfies isinstance checks throughout the app.
"""
from collections.abc import Iterator
from contextlib import contextmanager
from copy import deepcopy
from threading import RLock
from typing import Dict, Any, Optional, Iterable

from planner_lib.storage.base import StorageBackend


class MemoryStorage(StorageBackend):
    def __init__(self):
        self._lock = RLock()
        self._store: Dict[str, Any] = {}

    @contextmanager
    def transaction(self) -> Iterator[None]:
        """Serialize writers and restore the complete store when a transaction fails."""
        with self._lock:
            snapshot = deepcopy(self._store)
            try:
                yield
            except BaseException:
                self._store = snapshot
                raise

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            return self._store.get(key)

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._store[key] = value

    def delete(self, namespace: str, key: str) -> None:
        with self._lock:
            if namespace in self._store and isinstance(self._store[namespace], dict):
                self._store[namespace].pop(key, None)

    def save(self, namespace: str, key: str, value: Any, ttl_seconds=None) -> None:
        # ttl_seconds is accepted for interface compatibility but ignored.
        with self._lock:
            if namespace not in self._store:
                self._store[namespace] = {}
            self._store[namespace][key] = value

    def load(self, namespace: str, key: str) -> Optional[Any]:
        with self._lock:
            ns = self._store.get(namespace, {})
            if not isinstance(ns, dict) or key not in ns:
                raise KeyError(key)
            return ns.get(key)

    def list_keys(self, namespace: str) -> Iterable[str]:
        with self._lock:
            return tuple(self._store.get(namespace, {}).keys())

    def exists(self, namespace: str, key: str) -> bool:
        with self._lock:
            return namespace in self._store and key in self._store[namespace]

    def configure(self, **options) -> None:
        # Configuration is intentionally a no-op for the in-memory
        # backend; accept options for backward-compatible callers.
        return
