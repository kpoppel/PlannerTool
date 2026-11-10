import { html } from '../../vendor/lit.js';
import { getIconTemplate } from '../../services/IconService.js';
import { sel } from '../../application/imports.js';
import { featureTypeKey } from '../../application/shared/workItemDisplay.js';

const FILTER_ICON_PATHS = {
  schedule: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z',
  allocation: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2',
  hierarchy: 'M9 2h6v6H9ZM2 16h6v6H2Zm14 0h6v6h-6ZM12 8v4M5 16v-4h14v4',
  relations: 'm10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
};

export function renderFilterDimensionIcon(key) {
  return html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true"><path d=${FILTER_ICON_PATHS[key]}></path></svg>`;
}

function onFilterKeyDown(event) {
  if (event.key !== ' ' && event.key !== 'Enter') return;
  event.preventDefault();
  event.currentTarget.click();
}

export const SIDEBAR_FILTER_DIMENSIONS = [
  { key: 'schedule', title: 'Schedule', shortcut: 'P', options: [
    { key: 'planned', label: 'Planned' }, { key: 'unplanned', label: 'Unplanned' },
  ] },
  { key: 'allocation', title: 'Allocation', shortcut: 'A', options: [
    { key: 'allocated', label: 'Allocated' }, { key: 'unallocated', label: 'Unallocated' },
  ] },
  { key: 'hierarchy', title: 'Parent links', shortcut: 'I', options: [
    { key: 'hasParent', label: 'Has Parent' }, { key: 'noParent', label: 'No Parent' },
  ] },
  { key: 'relations', title: 'Relations', shortcut: 'R', options: [
    { key: 'hasLinks', label: 'Has Links' }, { key: 'noLinks', label: 'No Links' },
  ] },
];

export function getTaskFilterPresentation() {
  const features = sel.scope.getPresentableContextFeatures();
  const scopedTypes = new Set(features.map(featureTypeKey));
  const scopedStates = new Set(features.map((feature) => feature.state));
  const filters = sel.filter.getTaskFilters();
  const stateNames = [...new Set(features.flatMap((feature) =>
    sel.filter.getFeatureStates(feature).map((state) => state.name)))].filter((name) => scopedStates.has(name));
  const colors = sel.filter.getFeatureStateColors(stateNames);
  const selectedStates = sel.filter.getSelectedFeatureStateSet();
  return {
    dimensions: SIDEBAR_FILTER_DIMENSIONS.map((dimension) => ({ ...dimension,
      options: dimension.options.map((option) => ({ ...option,
        active: filters[dimension.key][option.key],
        disabled: sel.filter.isSidebarControlDisabled('taskFilter', dimension.key, option.key),
      })),
    })),
    states: stateNames.map((name) => ({
      name, color: colors[name].background, active: selectedStates.has(name),
      disabled: sel.filter.isSidebarControlDisabled('state', name),
    })),
    types: sel.feature.getTaskTypeOptions().filter((type) => scopedTypes.has(type.key))
      .map((type) => ({ ...type, active: sel.view.isTypeVisible(type.key),
        disabled: sel.filter.isSidebarControlDisabled('taskType', type.key) })),
  };
}

/** Render only projected values and dispatch named, value-based actions. */
export function renderSidebarTaskFilters({ model, actions }) {
  return html`
    ${model.types.length > 0 ? html`
      <div class="filter-dimension" data-filter-section="types">
        <div class="filter-dimension-title">Task Types</div>
        <div class="filter-options">
          ${model.types.map((type) => html`
            <div class="filter-option ${type.active ? 'active' : ''} ${type.disabled ? 'disabled' : ''}"
              role="checkbox" aria-checked=${type.active} aria-label=${type.name}
              tabindex=${type.disabled ? -1 : 0} @keydown=${onFilterKeyDown}
              data-type-key=${type.key}
              aria-disabled=${type.disabled ? 'true' : 'false'}
              @click=${() => { if (!type.disabled) actions.toggleType(type.key); }}
              title=${type.disabled ? 'Not relevant in current tool context' : ''}>
              <div class="filter-checkbox"></div>
              <div style="flex:1;display:flex;align-items:center;gap:4px;">
                <span style="width:16px;height:16px;flex-shrink:0;display:inline-flex;align-items:center;"
                  >${getIconTemplate(type.name)}</span>${type.name}
              </div>
            </div>
          `)}
        </div>
      </div>
    ` : ''}
    ${model.states.length > 0 ? html`
      <div class="filter-dimension" data-filter-section="states">
        <div class="filter-dimension-title">State</div>
        <div class="filter-options">
          ${model.states.map((state) => html`
            <div class="filter-option ${state.active ? 'active' : ''} ${state.disabled ? 'disabled' : ''}"
              role="checkbox" aria-checked=${state.active} aria-label=${state.name}
              tabindex=${state.disabled ? -1 : 0} @keydown=${onFilterKeyDown}
              aria-disabled=${state.disabled ? 'true' : 'false'}
              @click=${() => { if (!state.disabled) actions.toggleState(state.name); }}
              title=${state.disabled ? 'Not relevant in current tool context' : ''}>
              <div class="filter-checkbox"></div>
              <div style="display:inline-flex;align-items:center;gap:8px;flex:1;">
                <span class="filter-state-dot"
                  style="width:14px;height:14px;border-radius:3px;display:inline-block;background:${state.color};border:1px solid rgba(0,0,0,0.06);box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);"
                ></span>
                <div style="flex:1;color:#fff;">${state.name}</div>
              </div>
            </div>
          `)}
        </div>
      </div>
    ` : ''}
    ${model.states.length === 0 && model.types.length === 0 ? html`
      <div class="section-description"><span class="small">No filters available</span></div>
    ` : ''}
    <div class="filter-dimensions" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      ${model.dimensions.map((dimension) => html`
        <div class="filter-dimension" data-filter-section=${dimension.key}>
          <div class="filter-dimension-title shortcut-heading" data-filter-dimension=${dimension.key}>
            ${renderFilterDimensionIcon(dimension.key)} ${dimension.title}
            <kbd class="shortcut-pill" title=${`Cycle ${dimension.title} (${dimension.shortcut})`}>${dimension.shortcut}</kbd>
          </div>
          <div class="filter-options" style="display:flex;flex-direction:column;gap:6px;">
            ${dimension.options.map((option) => html`
              <div class="filter-option ${option.active ? 'active' : ''} ${option.disabled ? 'disabled' : ''}"
                role="checkbox" aria-checked=${option.active} aria-label=${option.label}
                tabindex=${option.disabled ? -1 : 0} @keydown=${onFilterKeyDown}
                aria-disabled=${option.disabled ? 'true' : 'false'}
                @click=${() => {
                  if (!option.disabled) actions.toggleFilter(dimension.key, option.key);
                }}
                title=${option.disabled ? 'Not relevant in current tool context' : ''}>
                <div class="filter-checkbox"></div>
                <span>${option.label}</span>
              </div>
            `)}
          </div>
        </div>
      `)}
    </div>
  `;
}