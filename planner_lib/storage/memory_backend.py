"""Simple memory-backed storage backend

This backend stores Python objects in memory as a data structure `[<namespace>][<key>]`.
"""
from threading import RLock
from typing import Dict, Any, Optional, Iterable

class MemoryStorage:
    def __init__(self):
        self._lock = RLock()
        self._store: Dict[str, Any] = {}

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            return self._store.get(key)

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._store[key] = value

    def delete(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)

    def save(self, namespace: str, key: str, value: Any) -> None:
        if namespace not in self._store:
            self._store[namespace] = {}
        with self._lock:
            self._store[namespace][key] = value

    def load(self, namespace: str, key: str) -> Optional[Any]:
        with self._lock:
            ns = self._store.get(namespace, {})
            return ns.get(key) if isinstance(ns, dict) else None

    def list_keys(self, namespace: str) -> Iterable[str]:
        with self._lock:
            return self._store.get(namespace, {}).keys()

    def exists(self, namespace: str, key: str) -> bool:
        with self._lock:
            return namespace in self._store and key in self._store[namespace]

    def configure(self, **options) -> None:
        # Configuration is intentionally a no-op for the simple file
        # backend; serializers handle formats. Accept options for
        # backward-compatible callers but ignore them.
        return
