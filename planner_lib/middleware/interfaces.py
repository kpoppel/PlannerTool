from typing import Protocol, Any, Optional, runtime_checkable


@runtime_checkable
class SessionManagerProtocol(Protocol):
    """Session manager public interface used by request handlers and middleware.

    The real `SessionManager` in `planner_lib.middleware.session` exposes
    these methods; the Protocol documents the surface tests and callers
    depend upon.
    """

    def create(self, email: str, device_id: Optional[str] = None) -> str: ...

    def get(self, session_id: str) -> Optional[dict[str, Any]]: ...

    def is_valid(self, session_id: str) -> bool: ...

    def delete(self, session_id: str) -> None: ...

    def delete_by_account_id(self, account_id: str) -> None: ...
