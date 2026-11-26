"""Relational projection of the shared iteration-set API document."""

from planner_lib.domain.iteration_sets import iteration_preset_id, validate_iteration_sets

from .planner_database import defer_foreign_keys


def write_iterations(connection, value):
    if validate_iteration_sets(value) != value:
        raise ValueError('Iteration sets require the canonical wire document')
    defer_foreign_keys(connection)
    connection.execute('DELETE FROM iteration_sets')
    for position, item in enumerate(value['iteration_sets']):
        set_id = item['id']
        backend = 'ado' if item['source_type'] == 'ado' else 'local'
        connection.execute('INSERT INTO iteration_sets VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                           (set_id, backend, position, item['name'], item['source_type'],
                            item['source_project'], item['root_path'], item['cached_at']))
        connection.executemany('INSERT INTO iteration_selections VALUES (?, ?, ?)',
                               ((set_id, order, path) for order, path in enumerate(item['selected_paths'])))
        rows = ((iteration_preset_id(set_id, row['path']), set_id, order, row['path'],
             row['name'], row['startDate'], row['finishDate'])
            for order, row in enumerate(item['values']))
        connection.executemany('INSERT INTO iterations VALUES (?, ?, ?, ?, ?, ?, ?)', rows)
        recipe = item['generator']
        if recipe is not None:
            connection.execute('INSERT INTO iteration_generators VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                               (set_id, recipe['start'], recipe['length'], recipe['unit'],
                                recipe['firstNumber'], recipe['prefix'], recipe['mode'],
                                recipe.get('count'), recipe.get('end')))


def read_iterations(connection):
    sets = []
    for row in connection.execute('SELECT * FROM iteration_sets ORDER BY position'):
        key = (row['iteration_set_id'],)
        recipe = connection.execute('''SELECT start_date AS start, length, unit,
            first_number AS firstNumber, prefix, mode, count, end_date AS end
            FROM iteration_generators WHERE iteration_set_id = ?''', key).fetchone()
        sets.append({
            'id': key[0], 'name': row['name'], 'source_type': row['source_type'],
            'source_project': row['source_project'], 'root_path': row['root_path'], 'cached_at': row['cached_at'],
            'selected_paths': [path for path, in connection.execute(
                'SELECT path FROM iteration_selections WHERE iteration_set_id = ? ORDER BY position', key)],
            'generator': None if recipe is None else {name: val for name, val in dict(recipe).items() if val is not None},
            'values': [dict(item) for item in connection.execute('''SELECT path, name, start_date AS startDate,
                finish_date AS finishDate FROM iterations WHERE iteration_set_id = ? ORDER BY position''', key)],
        })
    return {'iteration_sets': sets}