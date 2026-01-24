from typing import Any, Callable, Dict, TypeVar, cast

T = TypeVar("T")


class ServiceContainer:
    """A tiny, explicit DI container for registering singletons and factories.

    Usage is intentionally simple: register by key (string) and resolve via
    `get`. Factories are evaluated once and their result cached as singletons.
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
