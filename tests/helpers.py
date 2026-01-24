from typing import Any
from starlette.testclient import TestClient
from planner_lib.services.container import ServiceContainer


def register_service_on_client(client: TestClient, name: str, instance: Any) -> None:
    """Register a service instance into the app's DI container for tests.

    This helper ensures the legacy `app.state.<name>` attribute does not
    short-circuit resolution (it sets it to `None`) and then registers
    the instance into `app.state.container`.

    Usage in tests:
        from tests.helpers import register_service_on_client
        register_service_on_client(client, 'account_manager', fake_account_mgr)
    """
    # Ensure a container exists on the app and register the instance there.
    container = getattr(client.app.state, 'container', None)
    if container is None:
        container = ServiceContainer()
        client.app.state.container = container

    container.register_singleton(name, instance)


def register_services_on_client(client: TestClient, services: dict[str, Any]) -> None:
    for name, inst in services.items():
        register_service_on_client(client, name, inst)
