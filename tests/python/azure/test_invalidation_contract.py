"""Azure service invalidation capability contract."""

from unittest.mock import MagicMock

def test_azure_service_satisfies_invalidatable():
    from planner_lib.services.interfaces import Invalidatable
    from planner_lib.azure import AzureService

    svc = AzureService(organization_url="https://dev.azure.com/test", storage=MagicMock())
    assert isinstance(svc, Invalidatable), (
        "AzureService must implement Invalidatable so it can be registered "
        "in CacheCoordinator"
    )

