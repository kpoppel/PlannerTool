"""PlannerTool's SQLite task backend; no remote transport or credentials."""
from collections import defaultdict, deque

from planner_lib.backend.selection import LOCAL_BACKEND_ID
from planner_lib.domain.tasks import TaskConflictError
from planner_lib.local.tasks import LocalTasks


class LocalTaskBackend:
    BACKEND_ID = LOCAL_BACKEND_ID
    CAPABILITIES = frozenset({'task_read', 'task_create', 'task_publish', 'task_edit', 'task_delete',
                              'field_merge', 'relations_publish', 'history', 'markers', 'catalogue_edit'})
    # The database is authoritative; a response cache would serve stale revisions.
    CACHEABLE = False
    is_remote = False

    @classmethod
    def build_from_flags(cls, flags, *, planner_database, storage, local_catalogue, local_plans, **services):
        return cls(planner_database, storage, local_catalogue, local_plans)

    def __init__(self, database, storage, catalogue, plans):
        self._storage = storage
        self._catalogue = catalogue
        self._plans = plans
        self._tasks = LocalTasks(database, storage)

    def create_task(self, payload, actor_id, credential):
        return self._tasks.create(payload, actor_id)

    def task_editor_metadata(self):
        catalogue = self._catalogue.read()
        task_level = [entry['id'] for process in catalogue['processes']
                      for entry in process['types'] if entry['backlog_level'] == 'task']
        return {'catalogue': catalogue, 'plans': [
            {'id': plan['id'], 'name': plan['name'], 'typeIds': [*plan['task_types'], *task_level]}
            for plan in self.fetch_project_map()]}

    def write_tasks(self, updates, credential, *, actor_id, validate):
        edits = []
        for update in updates:
            base = update.get('base')
            if not isinstance(base, dict) or set(base) != {'revision', 'fields'}:
                raise ValueError('Local task writes require a reviewed revision and field baselines')
            edits.append({'id': update.get('id'), 'revision': base['revision'], 'before': base['fields'],
                          'fields': {field: value for field, value in update.items() if field not in {'id', 'base'}}})
        try:
            tasks = self._tasks.update_batch(edits, actor_id, validate)
        except TaskConflictError as exc:
            return {'ok': False, 'updated': 0, 'errors': [], 'conflicts': exc.conflicts}
        return {'ok': True, 'updated': len(tasks), 'errors': [], 'conflicts': []}

    def delete_task(self, task_id, revision, actor_id, credential):
        self._tasks.delete(task_id, revision, actor_id)

    def fetch_history(self, work_item_id, credential=None):
        return self._tasks.fetch_history(work_item_id)

    def work_item_display(self):
        return self._catalogue.work_item_display()

    def fetch_project_map(self, credential=None):
        return [plan for plan in self._plans.read()['plans'] if not plan['archived']]

    def fetch_projects(self, credential=None):
        config = self._storage.load('config', 'projects')
        levels = config['container_types']
        catalogue = self._catalogue.read()
        type_names = {entry['id']: entry['name']
                      for process in catalogue['processes'] for entry in process['types']}
        display = self.work_item_display()
        projects = []
        for plan in self.fetch_project_map():
            project = {key: value for key, value in plan.items() if key not in ('archived', 'markers')}
            project.update(container_order=levels.index(plan['type']), container_types=levels,
                           area_path=None, task_types=[type_names[identity] for identity in plan['task_types']],
                           work_item_display=display, allocation_defaults=config['allocation_defaults'])
            projects.append(project)
        return projects

    def fetch_task_collection(self):
        collection, selected_by_plan = self._tasks.read_collection()
        tasks = {task['id']: task for task in collection}
        by_plan = defaultdict(list)
        for task in tasks.values():
            by_plan[task['project']].append(task['id'])
            task['sourcePlanIds'] = []
            task['presentationPlanIds'] = []
        for plan_id, selected in selected_by_plan.items():
            pending = deque(by_plan[plan_id])
            visited = set(pending)
            while pending:
                identity = pending.popleft()
                task = tasks[identity]
                task['sourcePlanIds'].append(plan_id)
                if (task['process_id'], task['type']) in selected:
                    task['presentationPlanIds'].append(plan_id)
                for relation in task['relations']:
                    target = relation['id']
                    if target not in visited:
                        visited.add(target)
                        pending.append(target)
        return [task for task in tasks.values() if task['sourcePlanIds']]

    def list_plan_markers(self, project_id=None):
        return [{'plan_id': plan['id'], 'plan_name': plan['name'], 'project': plan['id'],
                 'team_id': None, 'team_name': None, 'marker': marker}
                for plan in self.fetch_project_map() if project_id is None or plan['id'] == project_id
                for marker in plan['markers']]