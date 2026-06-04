from typing import Protocol, Union, runtime_checkable
from planner_lib.accounts.config import AccountPayload
@runtime_checkable
class AccountManagerProtocol(Protocol):
    """Account manager interface used by the web layer.

    This Protocol describes the public surface that callers rely on. It is
    colocated with the `accounts` package since implementations live there
    and the shape is tightly coupled to that module's behaviour.
    """

    def save(self, config: AccountPayload) -> dict: ...

    def load(self, key: str) -> dict: ...

    def has_permission(self, key: str, permission: str) -> bool: ...

    def get_all_with_permission(self, permission: str) -> list: ...
        
    def count_all_with_permission(self, permission: str) -> int: ...

    def get_all_users(self) -> list: ...

    def sync_accounts_full(
        self,
        users: Union[list, dict],
        admins: Union[list, dict],
    ) -> None: ...