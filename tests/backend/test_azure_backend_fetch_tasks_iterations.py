from contextlib import contextmanager
from unittest.mock import MagicMock

from planner_lib.backend.azure import AzureDevOpsBackend


class _FakeConfig:
    def __init__(self, project_map, iterations_config):
        self._project_map = project_map
        self._iterations_config = iterations_config

    def fetch_project_map(self):
        return list(self._project_map)

    def fetch_iterations_config(self):
        return self._iterations_config


def _make_backend(config):
    backend = AzureDevOpsBackend(
        organization_url='MyOrg',
        storage=MagicMock(),
        team_repository=MagicMock(),
        capacity_service=MagicMock(),
        local_backend=config,
    )
    return backend


def test_build_iteration_map_uses_project_iteration_uuid_and_iteration_set():
    config = _FakeConfig(
        project_map=[
            {
                'id': 'project-a',
                'name': 'Team A',
                'area_path': 'MyADO\\TeamA',
                'iteration_uuid': 'set-a',
            }
        ],
        iterations_config={
            'iteration_sets': [
                {
                    'id': 'set-a',
                    'source_project': 'IterationsProject',
                    'root_path': 'Platform',
                }
            ]
        },
    )
    backend = _make_backend(config)
    client = MagicMock()
    client.get_iterations.return_value = [
        {
            'path': 'IterationsProject\\Iteration\\Platform\\Sprint 1',
            'startDate': '2026-01-01',
            'finishDate': '2026-01-14',
            'name': 'Sprint 1',
        }
    ]

    result = backend._build_iteration_map(client, 'MyADO\\TeamA', 'MyADO')

    client.get_iterations.assert_called_once_with(
        'IterationsProject',
        root_path='IterationsProject\\Iteration\\Platform',
    )
    assert result == {
        'Platform\\Sprint 1': {
            'startDate': '2026-01-01',
            'finishDate': '2026-01-14',
            'name': 'Sprint 1',
        }
    }


def test_build_iteration_map_skips_projects_without_iteration_set_association():
    config = _FakeConfig(
        project_map=[
            {
                'id': 'project-a',
                'name': 'Team A',
                'area_path': 'MyADO\\TeamA',
                'iteration_uuid': '',
            }
        ],
        iterations_config={'iteration_sets': []},
    )
    backend = _make_backend(config)
    client = MagicMock()

    result = backend._build_iteration_map(client, 'MyADO\\TeamA', 'MyADO')

    client.get_iterations.assert_not_called()
    assert result == {}


def test_fetch_tasks_attaches_failed_area_path_to_configuration_error():
    """The cache warning must identify the configured Azure DevOps path that failed."""
    from contextlib import contextmanager
    from types import SimpleNamespace
    import pytest
    from planner_lib.backend.errors import BackendConfigError

    backend = _make_backend(_FakeConfig(project_map=[], iterations_config={'iteration_sets': []}))

    class _FailingClient:
        def get_work_items(self, *args, **kwargs):
            raise RuntimeError('TF401232: area path does not exist')

    @contextmanager
    def _connect(_pat):
        yield _FailingClient()

    backend._conn = SimpleNamespace(connect=_connect)

    with pytest.raises(BackendConfigError) as raised:
        backend.fetch_tasks('MyADO\\MissingArea', credential={'token': 'valid'})

    assert raised.value.failed_path == 'MyADO\\MissingArea'