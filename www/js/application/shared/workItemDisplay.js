export function taskTypeKey(processId, name) {
  return JSON.stringify([processId, String(name).toLowerCase()]);
}

export function featureTypeKey(feature) {
  return taskTypeKey(feature.process_id, feature.type);
}

export function projectDisplay(projects) {
  return projects.length === 0 ? [] : projects[0].work_item_display;
}

export function displayTypes(display) {
  return display.flatMap((process) => process.tiers.flatMap((tier, level) =>
    tier.map((type) => ({ ...type, key: taskTypeKey(process.process_id, type.name),
      processId: process.process_id, level }))));
}

export function typeStateCategory(display, feature) {
  const type = displayTypes(display).find((item) => item.key === featureTypeKey(feature));
  if (type === undefined) return undefined;
  const state = type.states.find((item) => item.name === feature.state);
  return state === undefined ? undefined : state.category;
}

export function isAdjacentTypeParent(display, parent, child) {
  if (parent.process_id !== child.process_id) return false;
  const types = displayTypes(display);
  const parentType = types.find((type) => type.key === featureTypeKey(parent));
  const childType = types.find((type) => type.key === featureTypeKey(child));
  return parentType !== undefined && childType !== undefined
    && childType.level === parentType.level + 1;
}