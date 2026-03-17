"""Storage backend interface definitions.

Defines the StorageBackend abstract class used by the application to
persist and retrieve internal data representations. Implementations
should translate internal objects to whatever format the backend uses.

This module also provides SerializerBackend which composes a storage
backend with a serializer for transparent serialization.
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any, Iterable
from .serializer import Serializer

class StorageBackend(ABC):
    """Abstract storage backend.

    Implementations must be thread-safe if used concurrently.
    """

    @abstractmethod
    def save(self, namespace: str, key: str, value: Any) -> None:
        """Save `value` under `namespace` and `key`.

        Implementations should create directories as needed and ensure
        atomic writes when possible.
        """

    @abstractmethod
    def load(self, namespace: str, key: str) -> Any:
        """Load and return object stored under `namespace`/`key`.

        Should raise `KeyError` if the key does not exist.
        """

    @abstractmethod
    def delete(self, namespace: str, key: str) -> None:
        """Delete the stored object. Raise `KeyError` if not found."""

    @abstractmethod
    def list_keys(self, namespace: str) -> Iterable[str]:
        """Return an iterable of keys stored in `namespace`."""

    @abstractmethod
    def exists(self, namespace: str, key: str) -> bool:
        """Return True if `key` exists under `namespace`."""

    @abstractmethod
    def configure(self, **options) -> None:
        """Configure backend-specific options."""


# --- Composition helpers -------------------------------------------------

class SerializerBackend(StorageBackend):
    """Adapter that composes a StorageBackend with a Serializer.

    This adapter ensures that values passed to `save` are serialized using the
    provided `Serializer` and that `load` returns deserialized objects. It is
    used when callers want transparent serialization.
    """

    def __init__(self, backend: StorageBackend, serializer: Serializer) -> None:
        self._backend = backend
        self._serializer = serializer

    def save(self, namespace: str, key: str, value: Any) -> None:
        data = self._serializer.dump(value)
        # backend must accept bytes (FileStorageBackend does)
        self._backend.save(namespace, key, data)

    def load(self, namespace: str, key: str) -> Any:
        raw = self._backend.load(namespace, key)
        if isinstance(raw, (bytes, bytearray)):
            try:
                return self._serializer.load(bytes(raw))
            except Exception:
                return raw
        return raw

    def delete(self, namespace: str, key: str) -> None:
        return self._backend.delete(namespace, key)

    def list_keys(self, namespace: str) -> Iterable[str]:
        return self._backend.list_keys(namespace)

    def exists(self, namespace: str, key: str) -> bool:
        return self._backend.exists(namespace, key)

    def configure(self, **options) -> None:
        return self._backend.configure(**options)

