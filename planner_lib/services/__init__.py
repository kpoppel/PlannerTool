"""Services package: storage for DI interfaces and container.

Keep this package minimal — it only exposes the interfaces and container
used by the initial refactor steps.
"""
from .container import ServiceContainer, ServiceKeys
from .interfaces import (
    AccountManagerProtocol,
    SessionManagerProtocol,
    StorageBackend,
)

__all__ = [
    "ServiceContainer",
    "ServiceKeys",
    "AccountManagerProtocol",
    "SessionManagerProtocol",
    "StorageBackend",
]
