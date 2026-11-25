"""Typed settings carried in the existing ADO transport feature flag envelope."""

from math import isfinite


PATH_FIELDS = ('data_dir', 'generator_persist_dir', 'azure_mock_data_dir', 'static_data_path')
GENERATOR_INTEGERS = ('seed', 'n_plans', 'default_items_per_area', 'n_pis', 'sprints_per_pi',
                      'revisions_min', 'revisions_max', 'people_per_team')
GENERATOR_FIELDS = (*GENERATOR_INTEGERS, 'persist_dir', 'items_per_area', 'state_weights')


def write_transport_options(connection, scope, value):
    connection.execute('DELETE FROM ado_transport_paths WHERE scope = ?', (scope,))
    connection.execute('DELETE FROM ado_generator_settings WHERE scope = ?', (scope,))
    paths = {key: value[key] for key in PATH_FIELDS if key in value}
    if any(not isinstance(path, str) for path in paths.values()):
        raise ValueError('ADO transport paths must be strings')
    if paths:
        connection.execute('INSERT INTO ado_transport_paths VALUES (?, ?, ?, ?, ?)',
                           (scope, *(paths.get(key) for key in PATH_FIELDS)))
    if 'generator_config' in value:
        _write_generator(connection, scope, value['generator_config'])
    return {key: flag for key, flag in value.items() if key not in (*PATH_FIELDS, 'generator_config')}


def _write_generator(connection, scope, recipe):
    if not isinstance(recipe, dict) or set(recipe) - set(GENERATOR_FIELDS):
        raise ValueError('Unsupported synthetic generator settings')
    for key in GENERATOR_INTEGERS:
        if key in recipe and not (key == 'seed' and recipe[key] is None) and type(recipe[key]) is not int:
            raise ValueError(f'Synthetic generator {key} must be an integer')
    if 'persist_dir' in recipe and not isinstance(recipe['persist_dir'], str):
        raise ValueError('Synthetic generator persist_dir must be a string')
    connection.execute('INSERT INTO ado_generator_settings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                       (scope, *(recipe.get(key) for key in GENERATOR_INTEGERS), recipe.get('persist_dir'),
                        'seed' in recipe, 'items_per_area' in recipe, 'state_weights' in recipe))
    items = recipe.get('items_per_area', {})
    if not isinstance(items, dict) or any(type(count) is not int for count in items.values()):
        raise ValueError('Synthetic generator items_per_area must map area paths to integers')
    connection.executemany('INSERT INTO ado_generator_items_by_area VALUES (?, ?, ?)',
                           ((scope, area, count) for area, count in items.items()))
    weights = recipe.get('state_weights', {})
    if not isinstance(weights, dict) or any(
        not isinstance(vector, list) or len(vector) != 5
        or any(type(weight) not in (int, float) or not isfinite(weight) for weight in vector)
        for vector in weights.values()
    ):
        raise ValueError('Synthetic generator state_weights must contain five numbers per type')
    connection.executemany('INSERT INTO ado_generator_state_weights VALUES (?, ?, ?, ?, ?, ?, ?)',
                           ((scope, type_name, *vector) for type_name, vector in weights.items()))


def read_transport_options(connection, scope):
    paths = connection.execute('''SELECT data_dir, generator_persist_dir, azure_mock_data_dir, static_data_path
        FROM ado_transport_paths WHERE scope = ?''', (scope,)).fetchone()
    result = {} if paths is None else {key: path for key, path in dict(paths).items() if path is not None}
    recipe = connection.execute('SELECT * FROM ado_generator_settings WHERE scope = ?', (scope,)).fetchone()
    if recipe is None:
        return result
    generator = {key: recipe[key] for key in (*GENERATOR_INTEGERS, 'persist_dir') if recipe[key] is not None}
    if recipe['seed_present']:
        generator['seed'] = recipe['seed']
    if recipe['items_present']:
        generator['items_per_area'] = dict(connection.execute('''SELECT area_path, item_count
            FROM ado_generator_items_by_area WHERE scope = ?''', (scope,)).fetchall())
    if recipe['weights_present']:
        generator['state_weights'] = {name: vector for name, *vector in connection.execute('''
            SELECT type_name, new_weight, defined_weight, active_weight, resolved_weight, closed_weight
            FROM ado_generator_state_weights WHERE scope = ?''', (scope,))}
    result['generator_config'] = generator
    return result