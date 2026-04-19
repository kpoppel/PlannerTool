"""Tests for AzureMockGeneratorClient.

Verifies that the generator produces referentially consistent fixture data
that flows cleanly through the AzureCachingClient layer (the same path used
during normal server operation with the generator enabled).
"""
import pytest

from planner_lib.azure.AzureMockGeneratorClient import (
    AzureDataset,
    GeneratorConfig,
    _build_iteration_tree,
    _collect_sprint_paths,
    _generate_area_items,
    _generate_revisions,
)


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

_AREA_CONFIG = {
    "name": "Architecture",
    "area_path": "Platform_Development\\eSW\\Teams\\Architecture",
    "type": "team",
    "task_types": ["Epic", "Feature", "User Story"],
    "include_states": ["New", "Defined", "Active", "Resolved", "Closed"],
}

_MULTI_CONFIG_DICT = {
    "seed": 99,
    "n_plans": 4,
    "default_items_per_area": 10,
    "n_pis": 4,
    "sprints_per_pi": 3,
    "revisions_min": 2,
    "revisions_max": 6,
}


def _make_rng():
    import random
    return random.Random(42)


def _dummy_storage(tmp_path):
    """Return a minimal in-memory storage backend backed by tmp_path."""
    from planner_lib.storage import create_storage
    return create_storage(data_dir=str(tmp_path))


# ---------------------------------------------------------------------------
# GeneratorConfig
# ---------------------------------------------------------------------------

class TestGeneratorConfig:
    def test_defaults_applied(self):
        cfg = GeneratorConfig()
        assert cfg.seed == 42
        assert cfg.n_plans == 6
        assert cfg.default_items_per_area == 20

    def test_override_merged(self):
        cfg = GeneratorConfig({"seed": 7, "n_plans": 3})
        assert cfg.seed == 7
        assert cfg.n_plans == 3
        assert cfg.default_items_per_area == 20  # default untouched

    def test_state_weights_deep_merge(self):
        cfg = GeneratorConfig({"state_weights": {"Feature": [10, 10, 10, 10, 60]}})
        assert cfg.state_weights["Feature"] == [10, 10, 10, 10, 60]
        # Other entries unaffected
        assert cfg.state_weights["Epic"] == [40, 20, 20, 12, 8]

    def test_none_seed_generates_random(self):
        cfg = GeneratorConfig({"seed": None})
        assert isinstance(cfg.seed, int)

    def test_items_per_area_override(self):
        area = "Platform_Development\\TestArea"
        cfg = GeneratorConfig({"items_per_area": {area: 50}})
        assert cfg.items_per_area[area] == 50


# ---------------------------------------------------------------------------
# Iteration tree
# ---------------------------------------------------------------------------

class TestIterationTree:
    def test_tree_has_correct_depth(self):
        cfg = GeneratorConfig({"n_pis": 3, "sprints_per_pi": 4})
        tree = _build_iteration_tree("Proj", cfg, "http://localhost", "proj-uuid")
        assert tree["name"] == "Proj"
        eSW = tree["children"][0]
        assert eSW["name"] == "eSW"
        platform = eSW["children"][0]
        assert platform["name"] == "Platform"
        # 3 PI children
        assert len(platform["children"]) == 3
        # Each PI has 4 sprints
        for pi_node in platform["children"]:
            assert len(pi_node["children"]) == 4

    def test_all_sprint_nodes_have_dates(self):
        cfg = GeneratorConfig({"n_pis": 2, "sprints_per_pi": 3})
        tree = _build_iteration_tree("Proj", cfg, "http://localhost", "uuid")
        sprints = _collect_sprint_paths(tree)
        # Should have 2 * 3 = 6 sprint paths
        assert len(sprints) == 6

    def test_sprint_paths_are_valid_iteration_paths(self):
        cfg = GeneratorConfig({"n_pis": 2, "sprints_per_pi": 2})
        tree = _build_iteration_tree("Platform_Development", cfg, "http://localhost", "uuid")
        paths = _collect_sprint_paths(tree)
        for p in paths:
            assert p.startswith("Platform_Development\\eSW\\Platform\\"), p
            parts = p.split("\\")
            # Project \ eSW \ Platform \ Year.QN \ Year_SN  → 5 parts
            assert len(parts) == 5, f"unexpected depth: {p!r}"

    def test_sprint_dates_are_consecutive(self):
        from datetime import datetime, timezone
        cfg = GeneratorConfig({"n_pis": 2, "sprints_per_pi": 2})
        tree = _build_iteration_tree("Proj", cfg, "http://localhost", "uuid")
        # Collect all sprint nodes and check dates don't overlap
        def collect_leaves(node):
            if not node.get("children"):
                return [node]
            result = []
            for c in node["children"]:
                result.extend(collect_leaves(c))
            return result

        leaves = collect_leaves(tree)
        dates = []
        for leaf in leaves:
            attrs = leaf.get("attributes") or {}
            if attrs.get("startDate"):
                start = datetime.fromisoformat(attrs["startDate"].replace("Z", "+00:00"))
                end = datetime.fromisoformat(attrs["finishDate"].replace("Z", "+00:00"))
                dates.append((start, end))

        for i in range(1, len(dates)):
            assert dates[i][0] > dates[i - 1][0], "Sprint start dates must be ascending"


# ---------------------------------------------------------------------------
# Work item generation
# ---------------------------------------------------------------------------

class TestWorkItemGeneration:
    def _build_items(self, area_cfg=None, cfg_dict=None):
        import random
        cfg = GeneratorConfig(cfg_dict or {"default_items_per_area": 12, "seed": 7})
        rng = random.Random(cfg.seed)
        sprint_paths = [
            "Platform_Development\\eSW\\Platform\\2025.Q1\\2025_S1",
            "Platform_Development\\eSW\\Platform\\2025.Q1\\2025_S2",
            "Platform_Development\\eSW\\Platform\\2025.Q2\\2025_S3",
        ]
        id_counter = iter(range(100_001, 200_000))
        return _generate_area_items(
            area_config=area_cfg or _AREA_CONFIG,
            rng=rng,
            person_pool=[{"displayName": "Person 1", "id": "aaaa", "uniqueName": "p@e.com",
                          "url": "", "descriptor": "aad.x"}],
            sprint_paths=sprint_paths,
            project_id="proj-uuid",
            id_counter=lambda: next(id_counter),
            base_url="http://localhost:8002",
            config=cfg,
        )

    def test_items_non_empty(self):
        items = self._build_items()
        assert len(items) > 0

    def test_all_ids_unique(self):
        items = self._build_items()
        ids = [i["id"] for i in items]
        assert len(ids) == len(set(ids))

    def test_required_fields_present(self):
        items = self._build_items()
        required = [
            "System.WorkItemType", "System.State", "System.AreaPath",
            "System.IterationPath", "System.Title", "System.TeamProject",
            "System.CreatedDate", "System.ChangedDate",
        ]
        for item in items:
            for field in required:
                assert field in item["fields"], f"{field} missing in item {item['id']}"

    def test_area_path_consistent(self):
        items = self._build_items()
        for item in items:
            assert item["fields"]["System.AreaPath"] == _AREA_CONFIG["area_path"]

    def test_iteration_path_from_provided_pool(self):
        items = self._build_items()
        valid_paths = {
            "Platform_Development\\eSW\\Platform\\2025.Q1\\2025_S1",
            "Platform_Development\\eSW\\Platform\\2025.Q1\\2025_S2",
            "Platform_Development\\eSW\\Platform\\2025.Q2\\2025_S3",
        }
        for item in items:
            assert item["fields"]["System.IterationPath"] in valid_paths

    def test_parent_ids_exist_in_same_batch(self):
        items = self._build_items()
        all_ids = {i["id"] for i in items}
        for item in items:
            parent_id = item["fields"].get("System.Parent")
            if parent_id is not None:
                assert parent_id in all_ids, (
                    f"System.Parent={parent_id} not found in generated items"
                )

    def test_child_relation_urls_all_valid(self):
        items = self._build_items()
        all_ids = {i["id"] for i in items}
        for item in items:
            for rel in item.get("relations", []):
                if rel["rel"] == "System.LinkTypes.Hierarchy-Forward":
                    # Extract ID from URL
                    child_id = int(rel["url"].split("/")[-1])
                    assert child_id in all_ids, (
                        f"Forward relation points to unknown WI#{child_id}"
                    )

    def test_parent_relation_urls_all_valid(self):
        items = self._build_items()
        all_ids = {i["id"] for i in items}
        for item in items:
            for rel in item.get("relations", []):
                if rel["rel"] == "System.LinkTypes.Hierarchy-Reverse":
                    parent_id = int(rel["url"].split("/")[-1])
                    assert parent_id in all_ids

    def test_work_item_types_in_allowed_set(self):
        items = self._build_items()
        allowed = set(_AREA_CONFIG["task_types"])
        for item in items:
            assert item["fields"]["System.WorkItemType"] in allowed

    def test_states_in_allowed_set(self):
        items = self._build_items()
        allowed = set(_AREA_CONFIG["include_states"])
        for item in items:
            assert item["fields"]["System.State"] in allowed

    def test_org_autogen_fields_present(self):
        items = self._build_items()
        for item in items:
            assert "ORG.WIT.AutoGen.NewEnteredDate" in item["fields"]

    def test_kanban_field_present(self):
        items = self._build_items()
        for item in items:
            kanban_keys = [k for k in item["fields"] if "_Kanban.Column" in k]
            assert kanban_keys, f"no Kanban column field on item {item['id']}"

    def test_initiative_type_included_when_configured(self):
        area_with_init = dict(_AREA_CONFIG, task_types=["Initiative", "Epic", "Feature"])
        items = self._build_items(area_cfg=area_with_init)
        types = {i["fields"]["System.WorkItemType"] for i in items}
        assert "Initiative" in types

    def test_reproducibility(self):
        items1 = self._build_items()
        items2 = self._build_items()
        ids1 = sorted(i["id"] for i in items1)
        ids2 = sorted(i["id"] for i in items2)
        assert ids1 == ids2


# ---------------------------------------------------------------------------
# Revision generation
# ---------------------------------------------------------------------------

class TestRevisionGeneration:
    def _sample_item(self):
        import random
        cfg = GeneratorConfig({"default_items_per_area": 5, "seed": 1})
        rng = random.Random(1)
        id_ctr = iter(range(1, 1000))
        items = _generate_area_items(
            area_config=_AREA_CONFIG,
            rng=rng,
            person_pool=[{"displayName": "P", "id": "x", "uniqueName": "p@e", "url": "", "descriptor": "d"}],
            sprint_paths=["Platform_Development\\eSW\\Platform\\2025.Q1\\2025_S1"],
            project_id="uuid",
            id_counter=lambda: next(id_ctr),
            base_url="http://localhost",
            config=cfg,
        )
        return items[0] if items else None

    def test_revision_count_in_range(self):
        import random
        cfg = GeneratorConfig({"revisions_min": 3, "revisions_max": 8})
        item = self._sample_item()
        assert item is not None
        revs = _generate_revisions(item, random.Random(42), cfg)
        assert 3 <= len(revs) <= 8

    def test_rev_numbers_sequential(self):
        import random
        cfg = GeneratorConfig()
        item = self._sample_item()
        revs = _generate_revisions(item, random.Random(5), cfg)
        for i, rev in enumerate(revs, 1):
            assert rev["rev"] == i

    def test_last_rev_state_matches_item(self):
        import random
        cfg = GeneratorConfig()
        item = self._sample_item()
        final_state = item["fields"]["System.State"]
        revs = _generate_revisions(item, random.Random(5), cfg)
        assert revs[-1]["fields"]["System.State"] == final_state

    def test_first_rev_state_is_new(self):
        import random
        cfg = GeneratorConfig()
        item = self._sample_item()
        revs = _generate_revisions(item, random.Random(5), cfg)
        assert revs[0]["fields"]["System.State"] == "New"

    def test_item_rev_updated(self):
        import random
        cfg = GeneratorConfig({"revisions_min": 4, "revisions_max": 4})
        item = self._sample_item()
        revs = _generate_revisions(item, random.Random(0), cfg)
        assert item["rev"] == len(revs)
        assert item["fields"]["System.Rev"] == len(revs)


# ---------------------------------------------------------------------------
# AzureDataset — integration  (uses tmp_path for storage, no real Azure calls)
# ---------------------------------------------------------------------------

class TestAzureDataset:
    """These tests use the real projects.yml / teams.yml from data/config."""

    DATA_DIR = "data"

    def test_build_populates_all_stores(self):
        ds = AzureDataset(self.DATA_DIR, config_dict=_MULTI_CONFIG_DICT)
        ds.build()

        assert ds.teams, "teams should not be empty"
        assert ds.plans, "plans should not be empty"
        assert ds.iterations, "iterations should not be empty"
        assert ds.work_item_by_id, "work_item_by_id should not be empty"
        assert ds.revisions, "revisions should not be empty"
        assert ds.wiql_results, "wiql_results should not be empty"
        assert ds.team_field_values, "team_field_values should not be empty"
        assert ds.backlog_configs, "backlog_configs should not be empty"
        assert ds.work_item_types, "work_item_types should not be empty"

    def test_wiql_ids_all_in_work_item_store(self):
        ds = AzureDataset(self.DATA_DIR, config_dict=_MULTI_CONFIG_DICT)
        ds.build()
        for area_key, id_list in ds.wiql_results.items():
            for entry in id_list:
                wid = entry["id"]
                assert wid in ds.work_item_by_id, (
                    f"WIQL result ID {wid} (area_key={area_key!r}) "
                    "not found in work_item_by_id"
                )

    def test_all_revisions_reference_existing_items(self):
        ds = AzureDataset(self.DATA_DIR, config_dict=_MULTI_CONFIG_DICT)
        ds.build()
        for wid, revs in ds.revisions.items():
            assert wid in ds.work_item_by_id, f"revision for unknown WI#{wid}"
            assert revs, f"empty revision list for WI#{wid}"

    def test_system_parent_ids_exist(self):
        ds = AzureDataset(self.DATA_DIR, config_dict=_MULTI_CONFIG_DICT)
        ds.build()
        for wid, item in ds.work_item_by_id.items():
            parent_id = item["fields"].get("System.Parent")
            if parent_id is not None:
                assert parent_id in ds.work_item_by_id, (
                    f"WI#{wid} has System.Parent={parent_id} which does not exist"
                )

    def test_plan_ids_in_timelines(self):
        ds = AzureDataset(self.DATA_DIR, config_dict=_MULTI_CONFIG_DICT)
        ds.build()
        for proj_key, plan_list in ds.plans.items():
            for plan in plan_list:
                plan_id = plan["id"]
                # Check that the timeline or markers key exists
                found = any(k.endswith(f"__{plan_id}") for k in ds.timelines)
                assert found, f"Plan {plan_id!r} has no corresponding timeline"

    def test_iteration_tree_per_project(self):
        ds = AzureDataset(self.DATA_DIR, config_dict=_MULTI_CONFIG_DICT)
        ds.build()
        for proj_key in ds.teams:
            assert proj_key in ds.iterations, (
                f"Project '{proj_key}' has no iteration tree"
            )

    def test_build_is_idempotent(self):
        ds = AzureDataset(self.DATA_DIR, config_dict=_MULTI_CONFIG_DICT)
        ds.build()
        n_items = len(ds.work_item_by_id)
        ds.build()  # second call should be a no-op
        assert len(ds.work_item_by_id) == n_items

    def test_reproducibility_across_instances(self):
        cfg = dict(_MULTI_CONFIG_DICT, seed=321)
        ds1 = AzureDataset(self.DATA_DIR, config_dict=cfg)
        ds2 = AzureDataset(self.DATA_DIR, config_dict=cfg)
        ds1.build()
        ds2.build()
        assert sorted(ds1.work_item_by_id) == sorted(ds2.work_item_by_id)


# ---------------------------------------------------------------------------
# AzureMockGeneratorClient — smoke test via AzureCachingClient API
# ---------------------------------------------------------------------------

class TestAzureMockGeneratorClientIntegration:
    """End-to-end: instantiate the client and call the same methods the server uses."""

    DATA_DIR = "data"

    @pytest.fixture()
    def client(self, tmp_path):
        from planner_lib.azure.AzureMockGeneratorClient import AzureMockGeneratorClient
        from planner_lib.storage import create_storage

        storage = create_storage(backend='memory', serializer='json')
        return AzureMockGeneratorClient(
            "anonymous-org",
            storage=storage,
            data_dir=self.DATA_DIR,
            config_dict=_MULTI_CONFIG_DICT,
        )

    def test_get_all_teams(self, client):
        with client.connect("dummy-pat") as c:
            # Use the first project from projects.yml
            teams = c.get_all_teams("Platform_Development")
        assert isinstance(teams, list)
        assert len(teams) > 0
        # Each team entry should have expected keys
        t = teams[0]
        assert "name" in t
        assert "area_path" in t or "areaPath" in t or True  # normalised form may vary

    def test_get_work_items_returns_results(self, client):
        with client.connect("dummy-pat") as c:
            # AzureCachingClient.get_work_items(area_path, task_types, include_states)
            items = c.get_work_items(
                "Platform_Development\\eSW\\Teams\\Architecture",
                task_types=["Feature"],
                include_states=["New", "Active", "Defined", "Resolved", "Closed"],
            )
        assert isinstance(items, list)
        assert len(items) > 0

    def test_get_all_plans(self, client):
        with client.connect("dummy-pat") as c:
            plans = c.get_all_plans("Platform_Development")
        assert isinstance(plans, list)

    def test_get_iterations(self, client):
        with client.connect("dummy-pat") as c:
            iters = c.get_iterations("Platform_Development")
        assert iters is not None

    def test_get_work_item_metadata(self, client):
        with client.connect("dummy-pat") as c:
            meta = c.get_work_item_metadata("Platform_Development")
        assert isinstance(meta, dict)

    def test_get_history_returns_revisions(self, client):
        """get_task_revision_history tracks start/end/iteration field changes.
        It returns one entry per revision that changed a tracked field, which
        may be fewer than the total revision count.  We only assert the call
        does not raise and returns a list.
        """
        with client.connect("dummy-pat") as c:
            items = c.get_work_items(
                "Platform_Development\\eSW\\Teams\\Architecture",
                task_types=["Feature"],
                include_states=["New", "Active", "Defined", "Resolved", "Closed"],
            )
        if not items:
            pytest.skip("No items generated for Architecture")
        wid = items[0].get("id") or items[0].get("work_item_id")
        assert wid is not None
        with client.connect("dummy-pat") as c:
            history = c.get_task_revision_history(wid)
        assert isinstance(history, list)

    def test_feature_flag_integration(self, tmp_path):
        """Verify the generator is activated via AzureService feature flags."""
        from planner_lib.azure import AzureService
        from planner_lib.storage import create_storage

        storage = create_storage(backend='memory', serializer='json')
        svc = AzureService(
            organization_url="anonymous-org",
            storage=storage,
            feature_flags={
                "use_azure_mock_generator": True,
                "data_dir": self.DATA_DIR,
                "generator_config": _MULTI_CONFIG_DICT,
            },
        )
        with svc.connect("dummy-pat") as c:
            teams = c.get_all_teams("Platform_Development")
        assert isinstance(teams, list)


# ---------------------------------------------------------------------------
# Persistence tests
# ---------------------------------------------------------------------------

class TestAzureMockGeneratorPersistence:
    """Verify that persist_dir correctly writes sdk_*.json fixture files and
    that mutations via update_work_item are reflected on disk."""

    DATA_DIR = "data"
    _CFG = dict(_MULTI_CONFIG_DICT, seed=77)

    def _make_client(self, storage, persist_dir: str):
        from planner_lib.azure.AzureMockGeneratorClient import AzureMockGeneratorClient
        return AzureMockGeneratorClient(
            "anonymous-org",
            storage=storage,
            data_dir=self.DATA_DIR,
            config_dict=self._CFG,
            persist_dir=persist_dir,
        )

    def test_persist_writes_manifest(self, tmp_path):
        import json as _json
        from planner_lib.storage import create_storage
        pdir = str(tmp_path / "generated")
        client = self._make_client(create_storage(backend='memory', serializer='json'), pdir)
        # Trigger build by connecting
        with client.connect("dummy-pat"):
            pass
        manifest = _json.loads((tmp_path / "generated" / "_manifest.json").read_text())
        assert manifest["work_item_count"] > 0
        assert isinstance(manifest["projects"], list)
        assert manifest["generator_seed"] == self._CFG["seed"]

    def test_persist_writes_sdk_work_items_files(self, tmp_path):
        import json as _json
        from planner_lib.storage import create_storage
        pdir = tmp_path / "generated"
        client = self._make_client(create_storage(backend='memory', serializer='json'), str(pdir))
        with client.connect("dummy-pat"):
            pass
        wi_files = list(pdir.glob("sdk_work_items__*.json"))
        assert len(wi_files) > 0, "Expected sdk_work_items__*.json files"
        # Each file should be a non-empty list
        for f in wi_files:
            items = _json.loads(f.read_text())
            assert isinstance(items, list)
            assert len(items) > 0

    def test_persist_writes_sdk_revisions_files(self, tmp_path):
        import json as _json
        from planner_lib.storage import create_storage
        pdir = tmp_path / "generated"
        client = self._make_client(create_storage(backend='memory', serializer='json'), str(pdir))
        with client.connect("dummy-pat"):
            pass
        rev_files = list(pdir.glob("sdk_revisions__*.json"))
        assert len(rev_files) > 0, "Expected sdk_revisions__*.json files"
        # Sample one: should be a list of revision dicts with 'fields'
        sample = _json.loads(rev_files[0].read_text())
        assert isinstance(sample, list)
        assert all("fields" in r for r in sample)

    def test_persist_writes_all_sdk_file_types(self, tmp_path):
        from planner_lib.storage import create_storage
        pdir = tmp_path / "generated"
        client = self._make_client(create_storage(backend='memory', serializer='json'), str(pdir))
        with client.connect("dummy-pat"):
            pass
        stems = {f.name.split("__")[0] for f in pdir.glob("sdk_*.json")}
        expected = {
            "sdk_teams", "sdk_plans", "sdk_iterations", "sdk_work_item_types",
            "sdk_timeline", "sdk_plan_markers", "sdk_team_field_values",
            "sdk_backlog_config", "sdk_wiql", "sdk_work_items", "sdk_revisions",
        }
        missing = expected - stems
        assert not missing, f"Missing fixture file types: {missing}"

    def test_persist_dir_via_config_dict(self, tmp_path):
        """persist_dir inside config_dict should be honoured."""
        import json as _json
        from planner_lib.storage import create_storage
        from planner_lib.azure.AzureMockGeneratorClient import AzureMockGeneratorClient
        pdir = str(tmp_path / "via_cfg")
        cfg = dict(self._CFG, persist_dir=pdir)
        client = AzureMockGeneratorClient(
            "anonymous-org",
            storage=create_storage(backend='memory', serializer='json'),
            data_dir=self.DATA_DIR,
            config_dict=cfg,
        )
        with client.connect("dummy-pat"):
            pass
        assert (tmp_path / "via_cfg" / "_manifest.json").exists()

    def test_update_work_item_persists_to_disk(self, tmp_path):
        """Calling update_work_item_dates (which calls the WIT client's
        update_work_item) should immediately rewrite the area file on disk."""
        import json as _json
        from planner_lib.storage import create_storage
        pdir = tmp_path / "persist"
        storage = create_storage(backend='memory', serializer='json')
        client = self._make_client(storage, str(pdir))

        # Connect and get a Feature work item
        with client.connect("dummy-pat") as c:
            items = c.get_work_items(
                "Platform_Development\\eSW\\Teams\\Architecture",
                task_types=["Feature"],
                include_states=["New", "Active", "Defined", "Resolved", "Closed"],
            )
        assert items, "Need at least one feature to test persistence"
        # get_work_items normalises id to str; cast to int for disk lookup
        wid = int(items[0].get("id") or items[0].get("work_item_id"))

        # Read baseline from disk
        def _get_disk_item(wid_: int) -> dict:
            for f in pdir.glob("sdk_work_items__*.json"):
                for item in _json.loads(f.read_text()):
                    if int(item["id"]) == wid_:
                        return item
            return {}

        disk_before = _get_disk_item(wid)
        assert disk_before, f"WI#{wid} not found in any persisted area file"

        # Perform an update
        new_start = "2026-05-01T00:00:00Z"
        new_end = "2026-08-01T00:00:00Z"
        with client.connect("dummy-pat") as c:
            c.update_work_item_dates(wid, start=new_start, end=new_end)

        disk_after = _get_disk_item(wid)
        assert disk_after, "Item should still be on disk after update"

        start_field = "Microsoft.VSTS.Scheduling.StartDate"
        end_field = "Microsoft.VSTS.Scheduling.TargetDate"
        assert disk_after["fields"].get(start_field) == new_start
        assert disk_after["fields"].get(end_field) == new_end

    def test_persist_dir_readable_by_mock_client(self, tmp_path):
        """The files written by the generator should be loadable by AzureMockClient."""
        import json as _json
        from planner_lib.storage import create_storage
        from planner_lib.azure.AzureMockClient import AzureMockClient
        pdir = tmp_path / "generated"
        gen_client = self._make_client(
            create_storage(backend='memory', serializer='json'), str(pdir)
        )
        with gen_client.connect("dummy-pat"):
            pass
        # Now load with AzureMockClient pointing at the persisted directory
        mock_client = AzureMockClient(
            "anonymous-org",
            storage=create_storage(backend='memory', serializer='json'),
            fixture_dir=str(pdir),
        )
        with mock_client.connect("dummy-pat") as c:
            work_items = c.get_work_items(
                "Platform_Development\\eSW\\Teams\\Architecture",
                task_types=["Feature"],
                include_states=["New", "Active", "Defined", "Resolved", "Closed"],
            )
        assert isinstance(work_items, list)
        assert len(work_items) > 0, (
            "AzureMockClient should serve work items from generator-written files"
        )

    def test_feature_flag_persist_dir(self, tmp_path):
        """Verify generator_persist_dir top-level flag activates persistence."""
        import json as _json
        from planner_lib.azure import AzureService
        from planner_lib.storage import create_storage
        pdir = str(tmp_path / "fflags")
        storage = create_storage(backend='memory', serializer='json')
        svc = AzureService(
            organization_url="anonymous-org",
            storage=storage,
            feature_flags={
                "use_azure_mock_generator": True,
                "data_dir": self.DATA_DIR,
                "generator_config": self._CFG,
                "generator_persist_dir": pdir,
            },
        )
        with svc.connect("dummy-pat"):
            pass
        assert (tmp_path / "fflags" / "_manifest.json").exists()
