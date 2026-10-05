"""One-time migration 24 repair; stop source writers before running.

Preview: python scripts/repair_legacy_groups.py --data-dir /srv/data-esw
Retain a repaired installation: add --destination /srv/data-esw-repaired.
An explicit single installation writes directly to the destination; batches
write one installation subdirectory per source under the destination.
Sources, credentials, version strings, and later ledger entries are preserved.
"""

import argparse
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from planner_lib.storage.diskcache_backend import DiskCacheStorage

MIGRATION_ID = '0024.groups-members-and-pending-changes'
PREDECESSOR_ID = '0023.clean-ado-config-and-server-config'


def repair_groups(storage):
    groups = storage.load('groups', 'group_register') if storage.exists(
        'groups', 'group_register') else {}
    if not isinstance(groups, dict):
        raise ValueError('Invalid group register')
    for group_id, group in groups.items():
        if not isinstance(group, dict) or group.get('id') != group_id:
            raise ValueError('Invalid group register entry')
    if storage.exists('scenarios', 'scenario_register'):
        register = dict(storage.load('scenarios', 'scenario_register'))
        if 'schema' in register:
            if type(register['schema']) is not int or register['schema'] != 1:
                raise ValueError('Unsupported scenario register schema')
            del register['schema']
        for key, entry in register.items():
            if not isinstance(entry, dict) or key != entry['user'] + '_' + entry['id']:
                raise ValueError('Invalid scenario register entry')
        storage.save('scenarios', 'scenario_register', register)
    inferred = {}
    changed = 0
    stale = 0
    for key in storage.list_keys('scenarios'):
        if key == 'scenario_register':
            continue
        scenario = dict(storage.load('scenarios', key))
        overrides = {task_id: dict(override)
                     for task_id, override in scenario.get('overrides', {}).items()}
        dirty = False
        for task_id, override in list(overrides.items()):
            if 'groupId' not in override:
                continue
            group_id = override.pop('groupId')
            if group_id:
                group_id = str(group_id)
                if group_id in groups:
                    inferred.setdefault(group_id, set()).add(str(task_id))
                else:
                    stale += 1
            if not override:
                del overrides[task_id]
            dirty = True
        pending = scenario.get('pendingGroupChanges') or []
        if not isinstance(pending, list):
            raise ValueError('Invalid pending group changes')
        scenario_groups = list(scenario.get('scenarioGroups') or [])
        group_overrides = {group_id: dict(override)
                           for group_id, override in (scenario.get('groupOverrides') or {}).items()}
        scenario_group_ids = {group['id'] for group in scenario_groups}
        for operation in pending:
            if operation['type'] == 'create':
                group = operation['group']
                group_id = group['id']
                if group_id not in scenario_group_ids and group_id not in groups:
                    scenario_groups.append(dict(group))
                    scenario_group_ids.add(group_id)
            elif operation['type'] == 'update':
                group_id = operation['groupId']
                fields = operation.get('fields') or {}
                override = group_overrides.setdefault(group_id, {})
                override.update({field: value for field, value in fields.items()
                                 if field != 'members'})
                if 'members' in fields:
                    baseline = set(groups.get(group_id, {}).get('members') or [])
                    members = {str(member) for member in fields['members']}
                    deltas = {delta['taskId']: dict(delta)
                              for delta in (override.get('memberDeltas') or [])}
                    for task_id in sorted(members - baseline):
                        deltas[task_id] = {'taskId': task_id, 'op': 'add'}
                    for task_id in sorted(baseline - members):
                        deltas[task_id] = {'taskId': task_id, 'op': 'remove'}
                    override['memberDeltas'] = list(deltas.values())
            elif operation['type'] == 'delete':
                group_overrides.setdefault(operation['groupId'], {})['_deleted'] = True
            else:
                raise ValueError('Unknown pending group operation')
        if 'pendingGroupChanges' in scenario:
            del scenario['pendingGroupChanges']
            dirty = True
        if dirty:
            scenario.update(overrides=overrides, scenarioGroups=scenario_groups,
                            groupOverrides=group_overrides)
            storage.save('scenarios', key, scenario)
            changed += 1
    for group_id, task_ids in inferred.items():
        group = dict(groups[group_id])
        group['members'] = sorted(set(group.get('members') or []) | task_ids)
        groups[group_id] = group
    if inferred:
        storage.save('groups', 'group_register', groups)
    return {'changed_scenarios': changed, 'stale_group_references_removed': stale}


def discover_instances(sources):
    instances = set()
    for source in sources:
        source = Path(source)
        if source.is_symlink() or not source.is_dir():
            raise ValueError('Source must be an independent installation or parent directory')
        source = source.resolve()
        if (source / 'migrations.json').is_file():
            instances.add(source)
        else:
            instances.update(path for path in source.iterdir()
                             if path.is_dir() and (path / 'migrations.json').is_file())
    if not instances:
        raise ValueError('No legacy migration ledgers found in the supplied sources')
    return sorted(instances)


def repair_copies(sources, destination=None):
    instances = discover_instances(sources)
    single_instance = len(sources) == 1 and (Path(sources[0]) / 'migrations.json').is_file()
    pending = []
    for instance in instances:
        if instance.is_symlink() or (instance / 'migrations.json').is_symlink():
            raise ValueError('Source installation and ledger must not be symlinks')
        ledger = json.loads((instance / 'migrations.json').read_text())
        if not isinstance(ledger, dict) or not isinstance(ledger.get('applied'), list):
            raise ValueError(f'Invalid migration ledger: {instance.name}')
        if MIGRATION_ID in ledger['applied']:
            print(f'Skipping {instance.name}: migration 24 already recorded')
            continue
        if PREDECESSOR_ID not in ledger['applied']:
            print(f'Skipping {instance.name}: complete migrations through 23 first')
            continue
        if (instance / 'active-generation.json').exists():
            raise ValueError(f'Not a legacy installation: {instance.name}')
        if not (instance / 'cache/cache.db').is_file():
            raise ValueError(f'Legacy cache database missing: {instance.name}')
        if any(path.is_symlink() for path in instance.rglob('*')):
            raise ValueError(f'Source contains symlinks: {instance.name}')
        pending.append((instance, ledger))
    if not pending:
        print('No installations need migration 24')
        return []
    names = [instance.name for instance, ledger in pending]
    if len(set(names)) != len(names):
        raise ValueError('Source installation names must be unique')
    if destination is not None:
        destination = Path(destination).absolute()
        if destination.exists() or destination.is_symlink():
            raise ValueError('Destination must not exist')
        destination = destination.parent.resolve() / destination.name
        for instance in instances:
            if instance == destination or instance in destination.parents or destination in instance.parents:
                raise ValueError('Destination must be independent of every source installation')
    parent = destination.parent if destination is not None else None
    with tempfile.TemporaryDirectory(prefix='planner-migration24-', dir=parent) as temporary:
        batch = Path(temporary) / 'repaired'
        batch.mkdir(mode=0o700)
        for instance, ledger in pending:
            staged = batch / instance.name
            print(f'Repairing copy of {instance.name}')
            shutil.copytree(instance, staged)
            os.chmod(staged, 0o700)
            storage = DiskCacheStorage(staged / 'cache')
            try:
                with storage._cache.transact():
                    report = repair_groups(storage)
            finally:
                storage.close()
            print('  Converted:', report)
            ledger = {**ledger, 'applied': [*ledger['applied'], MIGRATION_ID]}
            with tempfile.NamedTemporaryFile(mode='w', dir=staged, delete=False) as output:
                json.dump(ledger, output, indent=2)
                output.write('\n')
                output.flush()
                os.fsync(output.fileno())
                temporary_ledger = Path(output.name)
            os.replace(temporary_ledger, staged / 'migrations.json')
        if destination is not None:
            if destination.exists() or destination.is_symlink():
                raise ValueError('Destination appeared during repair')
            output = batch / names[0] if single_instance else batch
            os.rename(output, destination)
        return names


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', '--source', dest='source', type=Path, nargs='+', required=True,
                        help='Stopped installation roots or parents containing them; never modified')
    parser.add_argument('--destination', type=Path,
                        help='New installation root for a single source, or parent for a batch; '
                            'omit for a temporary dry run')
    args = parser.parse_args()
    repaired = repair_copies(args.source, args.destination)
    print('Migration 24 completed for:', ', '.join(repaired) or 'none')
    if args.destination is None:
        print('Dry run complete; temporary repaired copy discarded. Source unchanged.')
    elif repaired:
        single_instance = len(args.source) == 1 and (args.source[0] / 'migrations.json').is_file()
        for name in repaired:
            output = args.destination if single_instance else args.destination / name
            print('Repaired installation root:', output)
        print('Sources, existing version fields, and other ledger entries unchanged.')


if __name__ == '__main__':
    main()