"""Transactional storage for reviewed ADO imports and their display tiers."""
from datetime import datetime, timezone

from planner_lib.azure.catalogue import (
    import_plan_types, import_selected_types, merge_catalogue, select_imports, sync_display,
    validate_plans,
)


class ProcessCatalogueManager:
    def __init__(self, storage, configs):
        self.storage = storage
        self.configs = configs

    def read(self):
        return self.configs.get_config('ado_processes', default={'schema_version': 1, 'processes': []})

    def reconcile_plan_imports(self):
        with self.storage.transaction():
            stored = self.read()
            plans = self.configs.get_config('projects', default={'project_map': []})['project_map']
            selected = import_plan_types(stored, plans)
            if selected == stored:
                return stored
            return self._commit(selected)

    def _commit(self, catalogue):
        plans = self.configs.get_config('projects', default={'project_map': []})['project_map']
        catalogue = import_plan_types(catalogue, plans)
        initial = {'schema_version': 2, 'process_order': [], 'type_tiers': {}}
        if self.storage.exists('config', 'ado_processes'):
            display = self.configs.get_config('global_settings', default=initial)
        else:
            display = initial
        self.configs.save_config('ado_processes', catalogue)
        self.configs.save_config('global_settings', sync_display(catalogue, display))
        return catalogue

    def refresh(self, processes):
        with self.storage.transaction():
            catalogue = merge_catalogue(
                self.read(), processes, datetime.now(timezone.utc).isoformat())
            return self._commit(catalogue)

    def load_process(self, process):
        with self.storage.transaction():
            stored = self.read()
            previous = [entry for entry in stored['processes'] if entry['id'] == process['id']]
            merged = merge_catalogue(
                {'schema_version': 1, 'processes': previous}, [process],
                datetime.now(timezone.utc).isoformat())['processes'][0]
            stored['processes'] = [merged if entry['id'] == merged['id'] else entry
                                   for entry in stored['processes']]
            if not previous:
                stored['processes'].append(merged)
            committed = self._commit(stored)
            return next(entry for entry in committed['processes'] if entry['id'] == merged['id'])

    def save(self, submitted):
        with self.storage.transaction():
            plans = self.configs.get_config('projects', default={'project_map': []})['project_map']
            return self._commit(select_imports(self.read(), submitted, plans))

    def save_plans(self, content, selections):
        with self.storage.transaction():
            catalogue = import_selected_types(self.read(), selections)
            catalogue = import_plan_types(catalogue, content['project_map'])
            plans = validate_plans(content, catalogue)
            display = self.configs.get_config('global_settings')
            self.configs.save_config('projects', plans)
            self.configs.save_config('ado_processes', catalogue)
            self.configs.save_config('global_settings', sync_display(catalogue, display))
            return plans