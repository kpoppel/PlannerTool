"""Simple file-backed storage backend

This backend stores Python objects under `./<datadir>/<namespace>/<key>.<extension>`.
It provides atomic writes by writing to a temporary file then renaming.
"""
from __future__ import annotations
import os
from pathlib import Path
from typing import Any, Iterable

from .base import StorageBackend
import logging

logger = logging.getLogger(__name__)


class FileStorageBackend(StorageBackend):
    def __init__(self, data_dir: str | Path = "./data") -> None:
        logger.debug("Initializing with data_dir=%s", data_dir)
        if not os.path.exists(data_dir):
            os.makedirs(data_dir, exist_ok=True)
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        # Optional file extension provided by the serializer (e.g. '.pkl')
        # If set externally (via create_storage), backend will append this
        # extension to filenames when reading/writing. Default is empty.
        self.file_extension: str = ""
        # File backend is intentionally dumb: it stores and returns raw
        # bytes (or text encoded as UTF-8). Serialization is handled by
        # higher-level serializers; this backend only manages file IO.

    def _ns_dir(self, namespace: str) -> Path:
        ns = self.data_dir / namespace
        ns.mkdir(parents=True, exist_ok=True)
        return ns

    def _path_for(self, namespace: str, key: str) -> Path:
        safe_key = key.replace("/", "_")
        ns = self._ns_dir(namespace)
        # Append serializer-defined extension if present and not already
        # included in the provided key. This centralizes filename handling
        # in the backend so callers only deal with logical keys.
        ext = self.file_extension or ""
        filename = safe_key
        if ext and not filename.endswith(ext):
            filename = f"{filename}{ext}"
        return ns / filename

    def save(self, namespace: str, key: str, value: Any) -> None:
        path = self._path_for(namespace, key)
        tmp = path.with_suffix(path.suffix + ".tmp")
        # Accept bytes/bytearray or str; write bytes to disk. Do not
        # attempt to (de)serialize Python objects here — serializers above
        # are responsible for that.
        if isinstance(value, (bytes, bytearray)):
            with open(tmp, "wb") as f:
                f.write(bytes(value))
                f.flush()
                os.fsync(f.fileno())
        else:
            # Convert other values to str and write as UTF-8 text. This
            # keeps compatibility with callers that pass YAML/text payloads.
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(str(value))
                f.flush()
                os.fsync(f.fileno())
        tmp.replace(path)

    def load(self, namespace: str, key: str) -> Any:
        path = self._path_for(namespace, key)
        if not path.exists():
            raise KeyError(key)
        # Always return raw bytes when reading. Callers that expect text
        # can decode the returned bytes. This keeps the backend simple and
        # lets higher layers choose serialization.
        with open(path, "rb") as f:
            data = f.read()
            logger.debug("Loaded bytes %s (%d bytes)", path, len(data))
            return data

    def delete(self, namespace: str, key: str) -> None:
        path = self._path_for(namespace, key)
        if not path.exists():
            raise KeyError(key)
        path.unlink()

    def list_keys(self, namespace: str) -> Iterable[str]:
        ns = self._ns_dir(namespace)
        for p in ns.iterdir():
            if not p.is_file():
                continue
            # Return logical keys without the serializer's file extension.
            name = p.name
            ext = self.file_extension or ""
            if ext and name.endswith(ext):
                name = name[: -len(ext)]
            yield name

    def exists(self, namespace: str, key: str) -> bool:
        return self._path_for(namespace, key).exists()

    def configure(self, **options) -> None:
        # Configuration is intentionally a no-op for the simple file
        # backend; serializers handle formats. Accept options for
        # backward-compatible callers but ignore them.
        return
