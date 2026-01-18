"""Storage backend interface definitions.

Defines the StorageBackend abstract class used by the application to
persist and retrieve internal data representations. Implementations
should translate internal objects to whatever format the backend uses.

This module also provides small composition helpers: `Serializer` and
`ValueAccessor` protocols plus concrete `PickleSerializer`/`JSONSerializer`
and `DictAccessor`/`ListAccessor`. A `ValueNavigatingStorage` wrapper composes
an existing `StorageBackend` with a serializer and accessor to provide
value-level `get_in`/`set_in`/`delete_in` helpers.
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any, Iterable, Sequence
from .serializer import Serializer
from .accessor import ValueAccessor

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
        """Configure backend-specific options.

        Options are backend-defined. For the file backend we support
        `mode` which can be `'pickle'` (default) or `'text'` (store plaintext).
        """


# --- Composition helpers -------------------------------------------------

class ValueNavigatingStorage:
    """Wrapper that composes a `StorageBackend` with a `Serializer` and a
    `ValueAccessor` to provide value-level get/set/delete operations inside
    stored objects.

    It keeps the underlying `StorageBackend` interface for compatibility.
    """

    def __init__(
        self,
        backend: StorageBackend,
        serializer: Serializer,
        accessor: ValueAccessor,
    ) -> None:
        self._backend = backend
        self._serializer = serializer
        self._accessor = accessor

    # StorageBackend-compatible methods (delegate)
    def save(self, namespace: str, key: str, value: Any) -> None:
        # Prefer to store serialized bytes; fall back to raw object if backend
        # expects Python objects.
        try:
            data = self._serializer.dump(value)
            self._backend.save(namespace, key, data)
        except Exception:
            self._backend.save(namespace, key, value)

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

    # Value-level helpers
    def get_in(self, namespace: str, key: str, path: Sequence[Any]) -> Any:
        value = self.load(namespace, key)
        return self._accessor.get(value, path)

    def set_in(self, namespace: str, key: str, path: Sequence[Any], new: Any) -> None:
        try:
            value = self.load(namespace, key)
        except KeyError:
            # create base container if missing
            value = {}
        value = self._accessor.set(value, path, new)
        self.save(namespace, key, value)

    def delete_in(self, namespace: str, key: str, path: Sequence[Any]) -> None:
        value = self.load(namespace, key)
        value = self._accessor.delete(value, path)
        self.save(namespace, key, value)


class SerializerBackend(StorageBackend):
    """Adapter that composes a StorageBackend with a Serializer.

    This adapter ensures that values passed to `save` are serialized using the
    provided `Serializer` and that `load` returns deserialized objects. It is
    used when callers want transparent serialization without value-level access.
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

