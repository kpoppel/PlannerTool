function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Select selected entity ids from a list with {id, selected} items.
 *
 * @param {Array<object>} items
 * @returns {string[]}
 */
export function selectSelectedIds(items = []) {
  return asArray(items)
    .filter((item) => item?.selected)
    .map((item) => item.id)
    .filter(Boolean);
}

/**
 * Select all entity ids from a list with {id} items.
 *
 * @param {Array<object>} items
 * @returns {string[]}
 */
export function selectAllIds(items = []) {
  return asArray(items)
    .map((item) => item?.id)
    .filter(Boolean);
}

/**
 * Select state names from a Set/Array of selected states.
 *
 * @param {Set<string>|Array<string>|null|undefined} selectedStates
 * @returns {string[]}
 */
export function selectSelectedStateNames(selectedStates) {
  if (selectedStates instanceof Set) return Array.from(selectedStates);
  return asArray(selectedStates);
}