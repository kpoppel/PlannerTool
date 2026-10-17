"""Normalize ADO process definitions at the SDK boundary."""
from __future__ import annotations

ZERO_ID = '00000000-0000-0000-0000-000000000000'
BACKLOG_LEVELS = {
    'System.TaskBacklogBehavior': 'task',
    'System.RequirementBacklogBehavior': 'requirement',
    'System.PortfolioBacklogBehavior': 'portfolio',
}


class ProcessOperations:
    def __init__(self, client):
        self.client = client

    def _sdk(self):
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):'.")
        return self.client.conn.clients.get_work_item_tracking_process_client()

    def list_processes(self) -> list[dict]:
        processes = self._sdk().get_list_of_processes(expand='projects')
        names = {process.type_id: process.name for process in processes}
        result = []
        for process in processes:
            entry = {
                'id': process.type_id,
                'name': process.name,
                'projects': [project.name for project in process.projects or []],
            }
            if process.parent_process_type_id not in (None, ZERO_ID):
                entry['parent_name'] = names[process.parent_process_type_id]
            result.append(entry)
        return result

    def get_process_types(self, process_id: str) -> list[dict]:
        sdk = self._sdk()
        behaviors = {entry.reference_name: entry
                     for entry in sdk.get_process_behaviors(process_id)}

        def backlogLevel(reference):
            visited = set()
            while reference not in BACKLOG_LEVELS:
                if reference in visited:
                    raise ValueError('Cyclic ADO backlog behavior inheritance')
                visited.add(reference)
                behavior = behaviors[reference]
                if behavior.inherits is None:
                    return 'none'
                reference = behavior.inherits.behavior_ref_name
            return BACKLOG_LEVELS[reference]

        result = []
        for item in sdk.get_process_work_item_types(process_id, expand='states,behaviors'):
            backlogs = []
            for association in item.behaviors or []:
                reference = association.behavior.id
                level = backlogLevel(reference)
                if level != 'none':
                    backlogs.append((reference, level, behaviors[reference].rank))
            backlogs.sort(key=lambda entry: (entry[1] == 'task', entry[2]), reverse=True)
            reference, level, rank = backlogs[0] if backlogs else (None, 'none', 0)
            result.append((rank, {
                'reference_name': item.reference_name,
                'name': item.name,
                'backlog_level': level,
                'backlog': reference,
                'imported': False,
                'missing': False,
                'states': [
                    {'name': state.name, 'category': state.state_category, 'order': state.order}
                    for state in sorted(item.states or [], key=lambda state: state.order)
                ],
            }))
        result.sort(key=lambda entry: -entry[0])
        return [entry[1] for entry in result]