from planner_lib.repository.iteration_repository import IterationRepository


class _FakeBackend:
    def __init__(self):
        self.calls = []

    def fetch_iterations(self, project, root_paths=None, credential=None):
        self.calls.append((project, root_paths, credential))
        return {
            f"{project}\\Sprint 1": {
                "name": "Sprint 1",
                "startDate": "2026-01-01",
                "finishDate": "2026-01-14",
            }
        }


class _FakeCredProvider:
    def get_credential(self, _user_id):
        return {"token": "x"}


class _SetBasedProjectRepo:
    def get_project_map(self):
        return [
            {
                "id": "project-a",
                "name": "A",
                "area_path": "MyProject\\A",
                "iteration_uuid": "set-a",
            },
            {
                "id": "project-b",
                "name": "B",
                "area_path": "MyProject\\B",
                "iteration_uuid": None,
            },
        ]


class _SetBasedIterationConfig:
    def fetch_iterations_config(self):
        return {
            "iteration_sets": [
                {
                    "id": "set-a",
                    "name": "Set A",
                    "source_project": "TeamA",
                    "root_path": "RootA",
                    "values": [],
                    "cached_at": None,
                }
            ]
        }


def test_list_iterations_uses_saved_snapshot_without_a_live_fetch():
    backend = _FakeBackend()
    repo = IterationRepository(
        backend=backend,
        project_repository=_SetBasedProjectRepo(),
        credential_provider=_FakeCredProvider(),
        iteration_config=_SetBasedIterationConfig(),
    )

    result = repo.list_iterations()

    assert sorted(result.keys()) == ["project-a"]
    assert result["project-a"]["iterationSetId"] == "set-a"
    assert result["project-a"]["sourceProject"] == "TeamA"
    assert result["project-a"]["roots"] == ["RootA"]
    assert result['project-a']['iterations'] == []
    assert backend.calls == []


def test_list_iterations_with_iteration_sets_has_no_implicit_default():
    backend = _FakeBackend()
    repo = IterationRepository(
        backend=backend,
        project_repository=_SetBasedProjectRepo(),
        credential_provider=_FakeCredProvider(),
        iteration_config=_SetBasedIterationConfig(),
    )

    result = repo.list_iterations(project_id="project-b")

    assert result == {}
    assert backend.calls == []


def test_normalize_iterations_orders_current_and_future_before_past():
    iterations = {
        "TeamA\\Q2": {
            "name": "Q2",
            "startDate": "2026-03-23",
            "finishDate": "2026-06-12",
        },
        "TeamA\\Q1": {
            "name": "Q1",
            "startDate": "2025-12-29",
            "finishDate": "2026-03-20",
        },
        "TeamA\\Q4": {
            "name": "Q4",
            "startDate": "2026-09-07",
            "finishDate": "2026-11-27",
        },
    }

    result = IterationRepository._normalize_iterations(iterations)

    assert [item["name"] for item in result] == ["Q4", "Q1", "Q2"]


class _SetWithValuesIterationConfig:
    def fetch_iterations_config(self):
        return {
            "iteration_sets": [
                {
                    "id": "set-a",
                    "name": "Set A",
                    "source_project": "TeamA",
                    "root_path": "RootA",
                    "values": [
                        {
                            "path": "TeamA\\RootA\\Sprint 2",
                            "name": "Sprint 2",
                            "startDate": "2026-02-01",
                            "finishDate": "2026-02-14",
                        }
                    ],
                    "cached_at": "2026-02-15T00:00:00Z",
                }
            ]
        }


def test_list_iterations_prefers_cached_set_values_when_present():
    backend = _FakeBackend()
    repo = IterationRepository(
        backend=backend,
        project_repository=_SetBasedProjectRepo(),
        credential_provider=_FakeCredProvider(),
        iteration_config=_SetWithValuesIterationConfig(),
    )

    result = repo.list_iterations(project_id="project-a")

    assert sorted(result.keys()) == ["project-a"]
    assert result["project-a"]["iterationSetId"] == "set-a"
    assert result["project-a"]["sourceProject"] == "TeamA"
    assert result["project-a"]["roots"] == ["RootA"]
    assert len(result["project-a"]["iterations"]) == 1
    assert result["project-a"]["iterations"][0]["path"] == "TeamA\\RootA\\Sprint 2"
    assert backend.calls == []


class _FailingBackend:
    def fetch_iterations(self, project, root_paths=None, credential=None):
        raise RuntimeError("backend unavailable")


def test_list_iterations_keeps_association_when_live_fetch_fails():
    repo = IterationRepository(
        backend=_FailingBackend(),
        project_repository=_SetBasedProjectRepo(),
        credential_provider=_FakeCredProvider(),
        iteration_config=_SetBasedIterationConfig(),
    )

    result = repo.list_iterations(project_id="project-a")

    assert sorted(result.keys()) == ["project-a"]
    assert result["project-a"]["sourceProject"] == "TeamA"
    assert result["project-a"]["roots"] == ["RootA"]
    assert result["project-a"]["iterations"] == []


def test_list_iteration_sets_returns_set_id_keyed_payload():
    backend = _FakeBackend()
    repo = IterationRepository(
        backend=backend,
        project_repository=_SetBasedProjectRepo(),
        credential_provider=_FakeCredProvider(),
        iteration_config=_SetWithValuesIterationConfig(),
    )

    result = repo.list_iteration_sets()

    assert sorted(result.keys()) == ["set-a"]
    assert result["set-a"]["id"] == "set-a"
    assert result["set-a"]["sourceProject"] == "TeamA"
    assert result["set-a"]["rootPath"] == "RootA"
    assert len(result["set-a"]["iterations"]) == 1
    preset, = result["set-a"]["presets"]
    iteration, = result["set-a"]["iterations"]
    assert set(preset) == {'id', 'label', 'start', 'end'}
    assert preset['id'] != iteration['path']
    assert preset['label'] == iteration['name']
    assert preset['start'] == iteration['startDate']
    assert preset['end'] == iteration['finishDate']
    assert repo.list_iteration_sets()["set-a"]["presets"] == [preset]


def test_schedule_presets_use_date_only_values_and_omit_incomplete_nodes():
    config = _SetWithValuesIterationConfig().fetch_iterations_config()
    values = config['iteration_sets'][0]['values']
    values[0]['startDate'] = '2026-02-01T00:00:00Z'
    values[0]['finishDate'] = '2026-02-14T00:00:00Z'
    values.extend([
        {'path': 'TeamA\\RootA', 'name': 'Root', 'startDate': None, 'finishDate': None},
        {'path': 'TeamA\\RootA\\Partial', 'name': 'Partial',
         'startDate': '2026-01-01', 'finishDate': None},
    ])
    iteration_config = type('Config', (), {'fetch_iterations_config': lambda self: config})()
    repo = IterationRepository(_FakeBackend(), _SetBasedProjectRepo(),
                               _FakeCredProvider(), iteration_config)
    preset, = repo.list_iteration_sets()['set-a']['presets']
    assert preset['start'] == '2026-02-01'
    assert preset['end'] == '2026-02-14'


def test_local_snapshots_resolve_for_plans_without_ado_project() -> None:
    config = _SetWithValuesIterationConfig().fetch_iterations_config()
    config['iteration_sets'][0]['source_type'] = 'manual'
    config['iteration_sets'][0]['source_project'] = None
    config['iteration_sets'][0]['root_path'] = None
    iteration_config = type('Config', (), {'fetch_iterations_config': lambda self: config})()
    backend = _FakeBackend()
    repo = IterationRepository(backend, _SetBasedProjectRepo(), _FakeCredProvider(), iteration_config)
    assert len(repo.list_iterations()['project-a']['iterations']) == 1
    assert len(repo.list_iteration_sets()['set-a']['presets']) == 1
    assert backend.calls == []
