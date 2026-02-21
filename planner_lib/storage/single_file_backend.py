"""Storage backend that maps all operations to a single specific file.

This backend ignores the provided `namespace` and `key` for storage
location decisions and always reads/writes the configured file path.
It returns raw bytes when reading so it composes cleanly with the
existing serializer wrappers.
"""
from __future__ import annotations
import os
from pathlib import Path
from typing import Any, Iterable
from .base import StorageBackend
import logging

logger = logging.getLogger(__name__)


class SingleFileStorage(StorageBackend):
    """Backend that targets a single on-disk file.

    Parameters
    - file_path: path to the single file used for all reads/writes.
      If the file does not exist, `load` will raise `KeyError`.
    """

    def __init__(self, file_path: str | Path) -> None:
        self.file_path = Path(file_path)
        # Ensure parent directory exists so writes succeed.
        if not self.file_path.parent.exists():
            os.makedirs(self.file_path.parent, exist_ok=True)
        # Optional extension hint set by higher-level code (serializers)
        self.file_extension: str = ""

    def _target_path(self) -> Path:
        # Respect an explicit extension on the configured file path: if
        # the provided `file_path` already has any suffix we treat that as
        # authoritative and do not append the serializer's extension. Only
        # append the serializer extension when the configured path has no
        # suffix and the backend was informed of one via `file_extension`.
        p = self.file_path
        ext = self.file_extension or ""
        # p.suffix is empty string when there's no extension
        if p.suffix:
            return p
        if ext:
            # ensure leading dot on extension
            if not ext.startswith('.'):
                ext = '.' + ext
            return p.with_name(p.name + ext)
        return p

    def save(self, namespace: str, key: str, value: Any) -> None:
        path = self._target_path()
        tmp = path.with_suffix(path.suffix + ".tmp")
        # Accept bytes/bytearray or str; write bytes to disk.
        if isinstance(value, (bytes, bytearray)):
            with open(tmp, "wb") as f:
                f.write(bytes(value))
                f.flush()
                os.fsync(f.fileno())
        else:
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(str(value))
                f.flush()
                os.fsync(f.fileno())
        tmp.replace(path)

    def load(self, namespace: str, key: str) -> Any:
        path = self._target_path()
        if not path.exists():
            raise KeyError(key)
        with open(path, "rb") as f:
            data = f.read()
            logger.debug("SingleFileStorage loaded %s (%d bytes)", path, len(data))
            return data

    def delete(self, namespace: str, key: str) -> None:
        path = self._target_path()
        if not path.exists():
            raise KeyError(key)
        path.unlink()

    def list_keys(self, namespace: str) -> Iterable[str]:
        path = self._target_path()
        if not path.exists():
            return iter(())
        # Expose a single logical key derived from the filename (without
        # serializer extension) so callers that iterate keys behave sensibly.
        name = path.name
        ext = self.file_extension or ""
        if ext and name.endswith(ext):
            name = name[: -len(ext)]
        return iter((name,))

    def exists(self, namespace: str, key: str) -> bool:
        return self._target_path().exists()

    def configure(self, **options) -> None:
        # Accept runtime configuration; allow overriding the file path.
        fp = options.get("file_path") or options.get("path")
        if fp:
            self.file_path = Path(fp)
            if not self.file_path.parent.exists():
                os.makedirs(self.file_path.parent, exist_ok=True)
        return
