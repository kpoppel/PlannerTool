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


class _V2RuleConfig:
    def fetch_iterations_config(self):
        return {
            "schema_version": 2,
            "default": {
                "source_project": "Platform_Development",
                "roots": ["Platform"],
            },
            "rules": [
                {
                    "rule_id": "by-project-name",
                    "priority": 20,
                    "match": {
                        "project_name": "Dalton",
                    },
                    "source_project": "eSW",
                    "roots": ["Dalton"],
                },
                {
                    "rule_id": "by-area-prefix",
                    "priority": 20,
                    "match": {
                        "area_path_prefix": "Platform_Development\\Tesla",
                    },
                    "source_project": "eSW",
                    "roots": ["Tesla"],
                },
            ],
        }


def test_list_iterations_applies_v2_rules_with_resolution_metadata():
    backend = _FakeBackend()
    repo = IterationRepository(
        backend=backend,
        project_repository=_FakeProjectRepo(),
        credential_provider=_FakeCredProvider(),
        iteration_config=_V2RuleConfig(),
    )

    result = repo.list_iterations()

    assert result["project-dalton"]["sourceProject"] == "eSW"
    assert result["project-dalton"]["roots"] == ["Dalton"]
    assert result["project-dalton"]["matchedRuleId"] == "by-project-name"
    assert result["project-dalton"]["fallbackUsed"] is False

    assert result["project-tesla"]["sourceProject"] == "eSW"
    assert result["project-tesla"]["roots"] == ["Tesla"]
    assert result["project-tesla"]["matchedRuleId"] == "by-area-prefix"
    assert result["project-tesla"]["fallbackUsed"] is False


class _V2NoMatchConfig:
    def fetch_iterations_config(self):
        return {
            "schema_version": 2,
            "default": {
                "source_project": "Platform_Development",
                "roots": ["Platform"],
            },
            "rules": [
                {
                    "rule_id": "unrelated",
                    "priority": 100,
                    "match": {
                        "project_name": "NotADefinedProject",
                    },
                    "source_project": "Other",
                    "roots": ["Nope"],
                }
            ],
        }


def test_list_iterations_v2_uses_default_when_no_rule_matches():
    backend = _FakeBackend()
    repo = IterationRepository(
        backend=backend,
        project_repository=_FakeProjectRepo(),
        credential_provider=_FakeCredProvider(),
        iteration_config=_V2NoMatchConfig(),
    )

    result = repo.list_iterations(project_id="project-dalton")

    assert result["project-dalton"]["sourceProject"] == "Platform_Development"
    assert result["project-dalton"]["roots"] == ["Platform"]
    assert result["project-dalton"]["matchedRuleId"] is None
    assert result["project-dalton"]["fallbackUsed"] is True
    assert result["project-dalton"]["resolutionWarnings"] == [
        "no_rule_matched_using_default"
    ]
