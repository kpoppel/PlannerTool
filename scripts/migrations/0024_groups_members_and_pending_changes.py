"""Convert legacy group data to the current model.

Two legacy formats are eliminated by this migration:

1. **feature.groupId in scenario overrides** (``scenario.overrides[featureId].groupId``)
   → Reconstructed as ``group.members = [featureId, ...]`` in the group store.

2. **scenario.pendingGroupChanges** (old deferred-mutation log)
   → Create ops that reference groups not yet in the baseline are converted to
     ``scenario.scenarioGroups`` entries so the new model can promote them.
   → Update ops (name/color/fields for baseline groups) are converted to
     ``scenario.groupOverrides[groupId]`` entries.
   → Delete ops for baseline groups are converted to
     ``scenario.groupOverrides[groupId]._deleted = True``.

After this migration runs, the application code no longer needs to read
``pendingGroupChanges`` or ``feature.groupId`` overrides.

The migration is idempotent: re-running it on already-converted data is safe.
"""

MIGRATION_ID = '0024.groups-members-and-pending-changes'


def upgrade(dry_run=False, backup=False):
    from collections import defaultdict
    from pathlib import Path
    import sys

    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root))

    try:
        from planner_lib.storage import create_storage
    except ImportError as e:
        print(f'Migration {MIGRATION_ID}: failed to import planner_lib: {e}')
        raise

    from planner_lib.groups import group_store
    from planner_lib.scenarios import scenario_store

    storage = create_storage(
        backend='diskcache',
        serializer='raw',
        data_dir=str(root / 'data' / 'cache'),
    )

    all_groups = group_store.list_groups(storage)
    baseline_group_ids = {g['id'] for g in all_groups}
    print(f"  Found {len(all_groups)} baseline groups")

    register = scenario_store.load_scenario_register(storage)
    print(f"  Found {len(register)} scenario register entries")

    # group_id → set[feature_id] collected from old groupId overrides
    inferred_members: dict = defaultdict(set)

    scenarios_to_update = []  # (user_id, scenario_id, scenario_data)

    for entry in register.values():
        user_id = entry.get('user', '')
        scenario_id = entry.get('id', '')
        if not scenario_id or not user_id:
            continue

        try:
            scen = scenario_store.load_user_scenario(storage, user_id, scenario_id)
        except Exception as exc:
            print(f"  WARNING: could not load scenario {scenario_id}: {exc}")
            continue

        dirty = False

        # ------------------------------------------------------------------
        # Part 1: feature.groupId overrides → group.members
        # ------------------------------------------------------------------
        overrides = scen.get('overrides') or {}
        for feature_id, ov in list(overrides.items()):
            if not isinstance(ov, dict) or 'groupId' not in ov:
                continue
            group_id = ov['groupId']
            if group_id:
                inferred_members[str(group_id)].add(str(feature_id))
            del ov['groupId']
            if not ov:
                del overrides[feature_id]
            dirty = True
        if dirty:
            scen['overrides'] = overrides

        # ------------------------------------------------------------------
        # Part 2: pendingGroupChanges → scenarioGroups / groupOverrides
        # ------------------------------------------------------------------
        pending = scen.get('pendingGroupChanges') or []
        if pending:
            if not isinstance(scen.get('scenarioGroups'), list):
                scen['scenarioGroups'] = scen.get('scenarioGroups') or []
            if not isinstance(scen.get('groupOverrides'), dict):
                scen['groupOverrides'] = scen.get('groupOverrides') or {}

            existing_sg_ids = {g['id'] for g in scen['scenarioGroups']}

            for op in pending:
                op_type = op.get('type')
                if op_type == 'create' and op.get('group'):
                    g = op['group']
                    g_id = g.get('id', '')
                    # Only add if not already in scenarioGroups and not in baseline
                    if g_id and g_id not in existing_sg_ids and g_id not in baseline_group_ids:
                        scen['scenarioGroups'].append(g)
                        existing_sg_ids.add(g_id)
                elif op_type == 'update' and op.get('groupId'):
                    gid = op['groupId']
                    fields = op.get('fields') or {}
                    # Scalar fields (name, color, …) go into the override as-is.
                    # A full `members` list is converted to memberDeltas by diffing
                    # against the baseline so the new delta model is used.
                    scalar_fields = {k: v for k, v in fields.items() if k != 'members'}
                    if gid not in scen['groupOverrides']:
                        scen['groupOverrides'][gid] = {}
                    scen['groupOverrides'][gid].update(scalar_fields)
                    if 'members' in fields:
                        base = next((g for g in all_groups if g['id'] == gid), None)
                        base_members = set(base.get('members') or []) if base else set()
                        new_members = set(str(m) for m in fields['members'])
                        deltas = (
                            [{'taskId': m, 'op': 'add'} for m in new_members - base_members] +
                            [{'taskId': m, 'op': 'remove'} for m in base_members - new_members]
                        )
                        existing = scen['groupOverrides'][gid].get('memberDeltas') or []
                        # last write per taskId wins
                        by_task = {d['taskId']: d for d in existing}
                        for d in deltas:
                            by_task[d['taskId']] = d
                        scen['groupOverrides'][gid]['memberDeltas'] = list(by_task.values())
                elif op_type == 'delete' and op.get('groupId'):
                    gid = op['groupId']
                    if gid not in scen['groupOverrides']:
                        scen['groupOverrides'][gid] = {}
                    scen['groupOverrides'][gid]['_deleted'] = True

            # Remove the now-converted pendingGroupChanges
            del scen['pendingGroupChanges']
            dirty = True

        if dirty:
            scenarios_to_update.append((user_id, scenario_id, scen))

    print(
        f"  Scenarios needing update: {len(scenarios_to_update)}"
        f"  (groupId overrides found in groups: {len(inferred_members)})"
    )

    # ------------------------------------------------------------------
    # Update group.members in the baseline store
    # ------------------------------------------------------------------
    for group_id, new_feature_ids in inferred_members.items():
        if group_id not in baseline_group_ids:
            print(
                f"  INFO: group {group_id} referenced in scenarios but no longer exists in baseline"
                f" — stale groupId references removed from scenarios; features become ungrouped"
            )
            continue
        try:
            existing = group_store.get_group(storage, group_id)
        except KeyError:
            print(f"  WARNING: could not load group {group_id}")
            continue

        existing_members = set(existing.get('members') or [])
        merged = sorted(existing_members | new_feature_ids)
        if merged == sorted(existing_members):
            print(f"  Group {group_id}: members already correct — skipping")
            continue

        print(f"  Group {group_id}: members {sorted(existing_members)} → {merged}")
        if not dry_run:
            group_store.update_group(storage, group_id, members=merged)

    # ------------------------------------------------------------------
    # Write back updated scenarios
    # ------------------------------------------------------------------
    for user_id, scenario_id, scen_data in scenarios_to_update:
        print(f"  Updating scenario {scenario_id} (user={user_id})")
        if not dry_run:
            try:
                scenario_store.save_user_scenario(storage, user_id, scenario_id, scen_data)
            except Exception as exc:
                print(f"  ERROR: could not save scenario {scenario_id}: {exc}")

    if not scenarios_to_update and not inferred_members:
        print('  Nothing to migrate — data is already current.')

    if dry_run:
        print('  DRY RUN: no changes written.')
