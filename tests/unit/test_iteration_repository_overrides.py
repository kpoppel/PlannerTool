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
            {"id": "project-dalton", "name": "Dalton", "area_path": "Platform_Development\\Dalton"},
            {"id": "project-tesla", "name": "Tesla", "area_path": "Platform_Development\\Tesla"},
        ]


class _FakeCredProvider:
    def get_credential(self, _user_id):
        return {"token": "x"}


class _FakeIterationConfig:
    def fetch_iterations_config(self):
        return {
            "azure_project": "Platform_Development",
            "default_roots": ["Platform"],
            "project_overrides": {
                "Dalton": {
                    "azure_project": "eSW",
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
    assert result["project-dalton"]["sourceProject"] == "eSW"
    assert result["project-dalton"]["roots"] == ["Dalton"]
    assert len(result["project-dalton"]["iterations"]) == 1
    assert result["project-tesla"]["sourceProject"] == "Platform_Development"
    assert result["project-tesla"]["roots"] == ["Platform"]
    assert backend.calls == [
        ("eSW", ["Dalton"], None),
        ("Platform_Development", ["Platform"], None),
    ]


class _LegacyKeyedIterationConfig:
    def fetch_iterations_config(self):
        return {
            "azure_project": "Platform_Development",
            "default_roots": ["Platform"],
            "project_overrides": {
                "Platform_Development": {
                    "azure_project": "eSW",
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
        ("Platform_Development", ["Platform"], None),
    ]
    result = repo.list_iterations(project_id="project-dalton")
    assert result
    assert result["project-dalton"]["sourceProject"] == "Platform_Development"
