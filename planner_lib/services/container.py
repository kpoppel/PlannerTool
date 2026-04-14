from typing import Any, Callable, Dict, TypeVar, cast

T = TypeVar("T")


class ServiceKeys:
    """Well-known string keys for the ServiceContainer.

    Use these constants instead of raw strings when registering or resolving
    services to get IDE auto-completion and catch typos before runtime.

    Example::

        container.register_singleton(ServiceKeys.AZURE_CLIENT, azure_client)
        client = container.get_typed(ServiceKeys.AZURE_CLIENT)
    """

    ACCOUNT_MANAGER = "account_manager"
    ADMIN_SERVICE = "admin_service"
    AZURE_CLIENT = "azure_client"
    AZURE_PROJECT_METADATA_SERVICE = "azure_project_metadata_service"
    CACHE_COORDINATOR = "cache_coordinator"
    CAPACITY_SERVICE = "capacity_service"
    COST_SERVICE = "cost_service"
    HEALTH_CONFIG = "health_config"
    HISTORY_SERVICE = "history_service"
    MEMORY_CACHE = "memory_cache"
    PEOPLE_SERVICE = "people_service"
    PROJECT_SERVICE = "project_service"
    SCENARIOS_STORAGE = "scenarios_storage"
    SERVER_CONFIG_STORAGE = "server_config_storage"
    SESSION_MANAGER = "session_manager"
    TASK_UPDATE_SERVICE = "task_update_service"
    TEAM_SERVICE = "team_service"
    VIEWS_STORAGE = "views_storage"


class ServiceContainer:
    """A tiny, explicit DI container for registering singletons and factories.

    Usage is intentionally simple: register by key (string or ServiceKeys
    constant) and resolve via `get`. Factories are evaluated once and their
    result cached as singletons.
    This keeps the implementation straightforward and easy to reason about.
    """

    def __init__(self) -> None:
        self._singletons: Dict[str, Any] = {}
        self._factories: Dict[str, Callable[[], Any]] = {}

    def register_singleton(self, key: str, instance: Any) -> None:
        self._singletons[key] = instance

    def register_factory(self, key: str, factory: Callable[[], Any]) -> None:
        self._factories[key] = factory

    def get(self, key: str) -> Any:
        if key in self._singletons:
            return self._singletons[key]
        if key in self._factories:
            inst = self._factories[key]()
            self._singletons[key] = inst
            return inst
        raise KeyError(f"No service registered for key '{key}'")

    def get_typed(self, key: str) -> T:
        """Resolve and cast to the expected type."""
        return cast(T, self.get(key))
