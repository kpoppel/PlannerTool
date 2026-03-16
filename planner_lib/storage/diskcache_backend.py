from pathlib import Path
from typing import Any, Iterable, Optional
import logging
import sys

from .base import StorageBackend

logger = logging.getLogger(__name__)

from diskcache import Cache

class DiskCacheStorage(StorageBackend):
    """Disk-backed storage using the `diskcache` library.

    Keys are stored internally as "<namespace>::<key>" so that
    `list_keys(namespace)` can be implemented efficiently.
    This backend stores exactly the Python object/value given to `save`.
    """

    def __init__(self, data_dir: str | Path = "./data/cache", size_limit: Optional[int] = None) -> None:
        self.data_dir = Path(data_dir)
        self.size_limit = size_limit
        # Some diskcache versions expect a numeric size_limit; pass a large
        # integer when no explicit limit was requested to avoid comparisons
        # between int and None in diskcache internals.
        effective_limit = size_limit if size_limit is not None else sys.maxsize
        self._cache = Cache(directory=str(self.data_dir), size_limit=effective_limit)
        # backward-compatible attribute used by create_storage
        self.file_extension: str = ""

    def _composite_key(self, namespace: str, key: str) -> str:
        #safe_key = key.replace("::", "_::")
        safe_key = key.replace("/", "_").replace("\\", "_")
        return f"{namespace}::{safe_key}"

    def save(self, namespace: str, key: str, value: Any) -> None:
        comp = self._composite_key(namespace, key)
        # diskcache will persist the Python object (including bytes)
        self._cache.set(comp, value)

    def load(self, namespace: str, key: str) -> Any:
        comp = self._composite_key(namespace, key)
        if comp not in self._cache:
            raise KeyError(key)
        return self._cache.get(comp)

    def delete(self, namespace: str, key: str) -> None:
        comp = self._composite_key(namespace, key)
        if comp not in self._cache:
            raise KeyError(key)
        self._cache.delete(comp)

    def list_keys(self, namespace: str) -> Iterable[str]:
        prefix = f"{namespace}::"
        for k in self._cache.iterkeys():
            # keys are expected to be str-like; coerce defensively
            try:
                kstr = k.decode("utf-8") if isinstance(k, (bytes, bytearray)) else str(k)
            except Exception:
                kstr = str(k)
            if kstr.startswith(prefix):
                yield kstr[len(prefix) :]

    def exists(self, namespace: str, key: str) -> bool:
        comp = self._composite_key(namespace, key)
        return comp in self._cache

    def configure(self, **options) -> None:
        # allow changing data_dir or size_limit by recreating cache
        new_dir = options.get("data_dir")
        new_size = options.get("size_limit", self.size_limit)
        if (new_dir and str(new_dir) != str(self.data_dir)) or new_size != self.size_limit:
            try:
                self._cache.close()
            except Exception:
                pass
            self.data_dir = Path(new_dir) if new_dir else self.data_dir
            self.size_limit = new_size
            effective = self.size_limit if self.size_limit is not None else sys.maxsize
            self._cache = Cache(directory=str(self.data_dir), size_limit=effective)

    def close(self) -> None:
        try:
            self._cache.close()
        except Exception:
            pass
