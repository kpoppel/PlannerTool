import { featureCanPresent } from './featureProjection.js';
import { displayTypes, featureTypeKey, projectDisplay } from './workItemDisplay.js';

function toTypeName(feature) {
  return feature.type;
}

export function deriveAvailableFeatureStates(features) {
  const states = [];
  const seen = new Set();

  for (const feature of features) {
    const stateName = feature.state;
    if (!stateName) continue;
    const key = String(stateName);
    if (seen.has(key)) continue;
    seen.add(key);
    states.push(key);
  }

  return states;
}

export function deriveAvailableTaskTypes(features) {
  const types = [];
  const seen = new Set();

  for (const feature of features) {
    if (!featureCanPresent(feature) && feature.ancestorOnly !== true) continue;
    const typeName = toTypeName(feature);
    if (!typeName) continue;
    const key = featureTypeKey(feature);
    if (seen.has(key)) continue;
    seen.add(key);
    types.push(key);
  }

  return types;
}

export function deriveConfiguredStateSequence(projects) {
  const sequence = [];
  const seen = new Set();

  for (const type of displayTypes(projectDisplay(projects))) {
    for (const state of type.states) {
      if (state.category === 'Removed' || seen.has(state.name)) continue;
      seen.add(state.name);
      sequence.push(state.name);
    }
  }

  return sequence;
}

export function deriveOrderedFeatureStateNames(projects, features) {
  const available = deriveAvailableFeatureStates(features);
  const configured = deriveConfiguredStateSequence(projects);

  if (configured.length === 0) {
    return available;
  }

  const ordered = [];
  const seen = new Set();

  for (const configuredState of configured) {
    const matchingState = available.find((stateName) => String(stateName) === String(configuredState));
    if (!matchingState || seen.has(matchingState)) continue;
    ordered.push(matchingState);
    seen.add(matchingState);
  }

  for (const stateName of available) {
    if (seen.has(stateName)) continue;
    ordered.push(stateName);
    seen.add(stateName);
  }

  return ordered;
}
