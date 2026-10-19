"""Source-neutral iteration-set validation and calendar generation."""
from datetime import date, timedelta
from typing import Any


def generate_iterations(settings: dict) -> list[dict]:
    """Generate contiguous, inclusive calendar ranges from an explicit recipe."""
    if not isinstance(settings, dict):
        raise ValueError('Generator settings must be an object')
    start = date.fromisoformat(settings['start'])
    length = settings['length']
    unit = settings['unit']
    first = settings['firstNumber']
    prefix = settings['prefix']
    if unit not in ('days', 'weeks') or type(length) is not int:
        raise ValueError('Choose an integer iteration length in days or weeks')
    days = length * (7 if unit == 'weeks' else 1)
    if not 1 <= days <= 366:
        raise ValueError('Iteration length must be 1 to 366 calendar days')
    if type(first) is not int or not 1 <= first <= 99999 or not isinstance(prefix, str) or not prefix.strip():
        raise ValueError('A name prefix and positive starting number are required')
    if settings['mode'] == 'until':
        end = date.fromisoformat(settings['end'])
        if end < start:
            raise ValueError('End date must be on or after start date')
        count = ((end - start).days + days) // days
    elif settings['mode'] == 'count':
        count = settings['count']
        if type(count) is not int or not 1 <= count <= 520:
            raise ValueError('Generate between 1 and 520 iterations')
        end = start + timedelta(days=days * count - 1)
    else:
        raise ValueError('Choose a generation mode')
    if not 1 <= count <= 520:
        raise ValueError('Generate between 1 and 520 iterations')
    rows = []
    for index in range(count):
        row_start = start + timedelta(days=index * days)
        row_end = min(end, row_start + timedelta(days=min(days - 1, (date.max - row_start).days)))
        rows.append({
            'path': f'generated-{first + index}', 'name': f'{prefix.strip()} {first + index}',
            'startDate': row_start.isoformat(), 'finishDate': row_end.isoformat(),
        })
    return rows


def validate_iteration_sets(content: Any) -> dict:
    """Validate persisted set snapshots without consulting an external source."""
    if not isinstance(content, dict) or not isinstance(content.get('iteration_sets'), list):
        raise ValueError('iteration_sets must be a list')
    result = []
    ids = set()
    for item in content['iteration_sets']:
        if not isinstance(item, dict):
            raise ValueError('Each iteration set must be an object')
        sid = item.get('id')
        name = item.get('name')
        source = item.get('source_type')
        if not isinstance(sid, str) or not sid.strip() or sid in ids:
            raise ValueError('Iteration set IDs must be non-empty and unique')
        ids.add(sid)
        if not isinstance(name, str) or not name.strip():
            raise ValueError('Each iteration set needs a name')
        if source not in ('ado', 'manual', 'generated'):
            raise ValueError('Choose an iteration source: ado, manual, or generated')
        project = item.get('source_project')
        if source == 'ado' and (not isinstance(project, str) or not project.strip()):
            raise ValueError('ADO sets require a source_project')
        if source != 'ado' and project is not None:
            raise ValueError('Local iteration sets must not specify an ADO project')
        values = item.get('values')
        if not isinstance(values, list):
            raise ValueError('Iteration values must be a list')
        generator = item.get('generator')
        if source == 'generated':
            values = generate_iterations(generator)
        elif generator is not None:
            raise ValueError('Only generated sets may have a generator recipe')
        paths = set()
        normalized = []
        for value in values:
            if not isinstance(value, dict):
                raise ValueError('Each iteration must be an object')
            path, label = value.get('path'), value.get('name')
            if not isinstance(path, str) or not path.strip() or path in paths:
                raise ValueError('Iteration identifiers must be non-empty and unique within a set')
            if not isinstance(label, str) or not label.strip():
                raise ValueError('Each iteration needs a name')
            paths.add(path)
            start, finish = value.get('startDate'), value.get('finishDate')
            if not isinstance(start, str) or not isinstance(finish, str):
                raise ValueError('Each included iteration requires start and end dates')
            start_date = date.fromisoformat(start.split('T')[0])
            finish_date = date.fromisoformat(finish.split('T')[0])
            if finish_date < start_date:
                raise ValueError('Iteration end date must be on or after its start date')
            normalized.append({'path': path, 'name': label.strip(),
                               'startDate': start_date.isoformat(), 'finishDate': finish_date.isoformat()})
        selected = item.get('selected_paths', [])
        if not isinstance(selected, list) or any(not isinstance(path, str) for path in selected):
            raise ValueError('selected_paths must be a list of iteration paths')
        result.append({
            'id': sid, 'name': name.strip(), 'source_type': source,
            'source_project': project.strip() if source == 'ado' else None,
            'root_path': item.get('root_path'), 'selected_paths': selected,
            'generator': generator, 'values': normalized, 'cached_at': item.get('cached_at'),
        })
    return {'iteration_sets': result}