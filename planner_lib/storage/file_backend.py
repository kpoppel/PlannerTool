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
import logging

logger = logging.getLogger(__name__)


class FileStorageBackend(StorageBackend):
    def __init__(self, data_dir: str | Path = "./data") -> None:
        logger.debug("Initializing with data_dir=%s", data_dir)
        if not os.path.exists(data_dir):
            os.makedirs(data_dir, exist_ok=True)
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        # storage mode: 'pickle' (binary pickled objects) or 'text' (plaintext files)
        self.mode = "pickle"

    def _ns_dir(self, namespace: str) -> Path:
        ns = self.data_dir / namespace
        ns.mkdir(parents=True, exist_ok=True)
        return ns

    def _path_for(self, namespace: str, key: str) -> Path:
        safe_key = key.replace("/", "_")
        ns = self._ns_dir(namespace)
        if self.mode == "text":
            return ns / f"{safe_key}"
        return ns / f"{safe_key}.pkl"

    def save(self, namespace: str, key: str, value: Any) -> None:
        path = self._path_for(namespace, key)
        tmp = path.with_suffix(path.suffix + ".tmp")
        if self.mode == "text":
            # write plaintext: accept str or bytes
            data = value
            if isinstance(data, (bytes, bytearray)):
                with open(tmp, "wb") as f:
                    f.write(bytes(data))
                    f.flush()
                    os.fsync(f.fileno())
            else:
                with open(tmp, "w", encoding="utf-8") as f:
                    f.write(str(data))
                    f.flush()
                    os.fsync(f.fileno())
        else:
            # binary mode: accept bytes (already serialized) or raw objects
            if isinstance(value, (bytes, bytearray)):
                with open(tmp, "wb") as f:
                    f.write(bytes(value))
                    f.flush()
                    os.fsync(f.fileno())
            else:
                with open(tmp, "wb") as f:
                    pickle.dump(value, f)
                    f.flush()
                    os.fsync(f.fileno())
        tmp.replace(path)

    def load(self, namespace: str, key: str) -> Any:
        path = self._path_for(namespace, key)
        if not path.exists():
            raise KeyError(key)
        if self.mode == "text":
            with open(path, "r", encoding="utf-8") as f:
                data = f.read()
                logger.debug("Loaded text %s", path)
                return data
        # binary mode: try to load as pickle, but if file contains raw bytes
        # (e.g. when ValueNavigatingStorage stored serialized bytes), return bytes.
        with open(path, "rb") as f:
            try:
                obj = pickle.load(f)
                logger.debug("Loaded %s: %s", path, type(obj))
                return obj
            except Exception:
                f.seek(0)
                data = f.read()
                logger.debug("Loaded raw bytes %s (%d bytes)", path, len(data))
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
            if self.mode == "text":
                yield p.name
            else:
                if p.suffix == ".pkl":
                    yield p.stem

    def exists(self, namespace: str, key: str) -> bool:
        return self._path_for(namespace, key).exists()

    def configure(self, **options) -> None:
        mode = options.get("mode")
        if mode:
            if mode not in ("pickle", "text"):
                raise ValueError("unsupported mode: %s" % mode)
            self.mode = mode
