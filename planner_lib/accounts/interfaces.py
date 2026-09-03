from typing import Protocol, Union, runtime_checkable
from planner_lib.accounts.config import AccountCredentialsPayload
@runtime_checkable
class AccountManagerProtocol(Protocol):
    """Account manager interface used by the web layer.

    This Protocol describes the public surface that callers rely on. It is
    colocated with the `accounts` package since implementations live there
    and the shape is tightly coupled to that module's behaviour.
    """

    def create_account(
        self,
        credentials: AccountCredentialsPayload,
        permissions: list[str] | None = None,
    ) -> dict: ...

    def update_credentials(self, credentials: AccountCredentialsPayload) -> dict: ...

    def set_permissions(self, account_id: str, permissions: list[str]) -> None: ...

    def get_account_by_id(self, account_id: str) -> dict: ...

    def get_account_id(self, email: str) -> str: ...

    def list_accounts(self) -> list[dict]: ...

    def delete_account(self, account_id: str) -> None: ...

    def load(self, key: str) -> dict: ...

    def has_permission(self, key: str, permission: str) -> bool: ...

    def get_all_with_permission(self, permission: str) -> list: ...
        
    def count_all_with_permission(self, permission: str) -> int: ...

    def get_all_users(self) -> list: ...

    def sync_accounts_full(
        self,
        users: dict,
        admins: Union[list, dict],
    ) -> None: ...