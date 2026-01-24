"""Services package: storage for DI interfaces and container.

Keep this package minimal — it only exposes the interfaces and container
used by the initial refactor steps.
"""
from .container import ServiceContainer
from .interfaces import (
    AccountManagerProtocol,
    SessionManagerProtocol,
    StorageProtocol,
)

__all__ = [
    "ServiceContainer",
    "AccountManagerProtocol",
    "SessionManagerProtocol",
    "StorageProtocol",
]
