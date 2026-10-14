function validateAvailableIds(ids, catalogue) {
  const seen = new Set();
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) {
      throw new Error(`Invalid or duplicate allocation availability ID: ${id}`);
    }
    if (!catalogue.has(id)) throw new Error(`Unknown allocation availability ID: ${id}`);
    seen.add(id);
  }
}

export function projectAllocationAvailability({ feature, projects, catalogue, allocationDefaults }) {
  const byId = new Map(catalogue.map((item) => [item.id, item]));
  if (byId.size !== catalogue.length) throw new Error('Allocation catalogue contains duplicate IDs');
  for (const ids of Object.values(allocationDefaults)) validateAvailableIds(ids, byId);
  for (const project of projects) {
    if (Object.hasOwn(project, 'allocatable_ids')) validateAvailableIds(project.allocatable_ids, byId);
    if (!Object.hasOwn(allocationDefaults, project.type)) {
      throw new Error(`Missing allocation default for container type: ${project.type}`);
    }
  }
  const owner = projects.find((project) => project.id === feature.project);
  const ids = owner === undefined ? [] : Object.hasOwn(owner, 'allocatable_ids')
    ? owner.allocatable_ids : allocationDefaults[owner.type];
  const allowed = ids.filter((id) => !byId.get(id).archived);
  return {
    allowed_ids: allowed,
    existing: feature.capacity.map((allocation) => {
      const definition = byId.get(allocation.team);
      return {
        team: allocation.team, capacity: allocation.capacity,
        known: definition !== undefined,
        archived: definition === undefined ? false : definition.archived,
        eligible: allowed.includes(allocation.team),
      };
    }),
  };
}

export function validateAllocationChange(availability, capacity) {
  const allowed = new Set([...availability.allowed_ids, ...availability.existing.map((item) => item.team)]);
  const retainedDuplicates = new Map();
  for (const item of availability.existing) {
    if (item.known) continue;
    if (!retainedDuplicates.has(item.team)) retainedDuplicates.set(item.team, []);
    retainedDuplicates.get(item.team).push(item.capacity);
  }
  for (const [team, amounts] of retainedDuplicates) {
    if (amounts.length < 2) retainedDuplicates.delete(team);
  }
  const seen = new Set();
  for (const allocation of capacity) {
    if (Object.keys(allocation).sort().join(',') !== 'capacity,team') {
      throw new Error('Allocation requires exactly team and capacity');
    }
    const { team, capacity: amount } = allocation;
    if (typeof team !== 'string' || team.length === 0 || seen.has(team)) {
      throw new Error(`Invalid or duplicate allocation ID: ${team}`);
    }
    if (!Number.isFinite(amount) || amount < 0 || amount > 100) {
      throw new Error(`Allocation percentage must be finite and between 0 and 100: ${team}`);
    }
    if (!allowed.has(team)) throw new Error(`Allocation is not offered for this item: ${team}`);
    if (retainedDuplicates.has(team)) {
      const amounts = retainedDuplicates.get(team);
      const index = amounts.indexOf(amount);
      if (index === -1) throw new Error('Unresolved duplicate allocations must remain unchanged');
      amounts.splice(index, 1);
      continue;
    }
    seen.add(team);
  }
  if ([...retainedDuplicates.values()].some((amounts) => amounts.length > 0)) {
    throw new Error('Unresolved duplicate allocations must remain unchanged');
  }
}