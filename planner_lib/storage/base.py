"""Storage backend interface definitions.

Defines the StorageBackend abstract class used by the application to
persist and retrieve internal data representations. Implementations
should translate internal objects to whatever format the backend uses.
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any, Iterable, Protocol


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
