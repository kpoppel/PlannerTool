from typing import Protocol, Any, Iterable, Sequence, runtime_checkable


@runtime_checkable
class StorageProtocol(Protocol):
    """Storage backend protocol mirroring `planner_lib.storage.StorageBackend`.

    Implementations should follow the semantics documented on the abstract
    base class in `planner_lib.storage.base` (KeyError for missing keys,
    thread-safety where required, etc.).
    """

    def save(self, namespace: str, key: str, value: Any) -> None: ...

    def load(self, namespace: str, key: str) -> Any: ...

    def delete(self, namespace: str, key: str) -> None: ...

    def list_keys(self, namespace: str) -> Iterable[str]: ...

    def exists(self, namespace: str, key: str) -> bool: ...

    def configure(self, **options) -> None: ...
