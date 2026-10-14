"""Explicit coordinated canonical workforce service registration."""
from planner_lib.admin.workforce_service import WorkforceAdminService
from planner_lib.backend.config import WorkforceConfigBackend
from planner_lib.cost.service import WorkforceCostService
from planner_lib.repository.task_repository import WorkforceTaskRepository
from planner_lib.repository.team_repository import WorkforceTeamRepository
from planner_lib.services.container import ServiceContainer


def register_workforce_runtime(container: ServiceContainer) -> None:
    """Select canonical owners before resolving any dependent runtime service."""
    owners = ('config_backend', 'team_repository', 'task_repository', 'cost_service', 'admin_service',
              'project_repository', 'backend', 'capacity_service')
    if any(key in container._singletons for key in owners):
        raise RuntimeError('Canonical workforce registration must precede service resolution')
    container.register_factory('config_backend', lambda: WorkforceConfigBackend(container.get('storage')))
    container.register_factory('team_repository', lambda: WorkforceTeamRepository(
        local_backend=container.get('config_backend'),
    ))
    container.register_factory('task_repository', lambda: WorkforceTaskRepository(
        backend=container.get('backend'), project_repository=container.get('project_repository'),
        credential_provider=container.get('credential_provider'), storage=container.get('storage'),
        task_storage=container.get('remote_cache_storage'),
    ))
    container.register_factory('cost_service', lambda: WorkforceCostService(
        storage=container.get('storage'), project_repository=container.get('project_repository'),
    ))
    container.register_factory('admin_service', lambda: WorkforceAdminService(
        storage=container.get('storage'), task_storage=container.get('remote_cache_storage'),
        project_repository=container.get('project_repository'),
        account_manager=container.get('account_manager'), azure_client=container.get('azure_client'),
        reloadable_services=[container.get('backend'), container.get('cost_service')],
    ))


def refresh_workforce_backend_cache(container: ServiceContainer) -> None:
    """Complete the persisted one-time cutover refresh before serving any HTTP requests."""
    storage = container.get('storage')
    required = storage.load('system', 'workforce_backend_refresh_required')
    if type(required) is not bool:
        raise ValueError('Workforce backend refresh marker must be boolean')
    if not required:
        return
    remote = container.get('remote_cache_storage')
    with storage.transaction(), remote.transaction():
        for key in list(remote.list_keys('backend_domain')):
            remote.delete('backend_domain', key)
        storage.save('system', 'workforce_backend_refresh_required', False)