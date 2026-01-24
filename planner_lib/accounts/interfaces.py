from typing import Protocol, Any, runtime_checkable


@runtime_checkable
class AccountManagerProtocol(Protocol):
    """Account manager interface used by the web layer.

    This Protocol describes the public surface that callers rely on. It is
    colocated with the `accounts` package since implementations live there
    and the shape is tightly coupled to that module's behaviour.
    """

    def save(self, config: Any) -> dict: ...

    def load(self, key: str) -> dict: ...
