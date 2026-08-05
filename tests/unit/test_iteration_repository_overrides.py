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


class _FakeProjectRepo:
    def get_project_map(self):
        return [
            {"id": "project-dalton", "name": "Dalton", "area_path": "MyProject\\Dalton"},
            {"id": "project-tesla", "name": "Tesla", "area_path": "MyProject\\Tesla"},
        ]


class _FakeCredProvider:
    def get_credential(self, _user_id):
        return {"token": "x"}


class _FakeIterationConfig:
    def fetch_iterations_config(self):
        return {
            "azure_project": "MyProject",
            "default_roots": ["Platform"],
            "project_overrides": {
                "Dalton": {
                    "azure_project": "TeamA",
                    "roots": ["Dalton"],
                }
            },
        }


def test_list_iterations_uses_per_configured_project_override_source_and_roots():
    backend = _FakeBackend()
    repo = IterationRepository(
        backend=backend,
        project_repository=_FakeProjectRepo(),
        credential_provider=_FakeCredProvider(),
        iteration_config=_FakeIterationConfig(),
    )

    result = repo.list_iterations()

    assert sorted(result.keys()) == ["project-dalton", "project-tesla"]
    assert result["project-dalton"]["sourceProject"] == "TeamA"
    assert result["project-dalton"]["roots"] == ["Dalton"]
    assert len(result["project-dalton"]["iterations"]) == 1
    assert result["project-tesla"]["sourceProject"] == "MyProject"
    assert result["project-tesla"]["roots"] == ["Platform"]
    assert backend.calls == [
        ("TeamA", ["Dalton"], None),
        ("MyProject", ["Platform"], None),
    ]


class _LegacyKeyedIterationConfig:
    def fetch_iterations_config(self):
        return {
            "azure_project": "MyProject",
            "default_roots": ["Platform"],
            "project_overrides": {
                "MyProject": {
                    "azure_project": "TeamA",
                    "roots": ["LegacyShouldNotApply"],
                }
            },
        }


def test_list_iterations_does_not_apply_azure_project_keyed_override_anymore():
    backend = _FakeBackend()
    repo = IterationRepository(
        backend=backend,
        project_repository=_FakeProjectRepo(),
        credential_provider=_FakeCredProvider(),
        iteration_config=_LegacyKeyedIterationConfig(),
    )

    repo.list_iterations()

    assert backend.calls == [
        ("MyProject", ["Platform"], None),
    ]
    result = repo.list_iterations(project_id="project-dalton")
    assert result
    assert result["project-dalton"]["sourceProject"] == "MyProject"


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


def test_list_iterations_uses_project_iteration_uuid_when_iteration_sets_present():
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
    assert backend.calls == [("TeamA", ["RootA"], None)]


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
