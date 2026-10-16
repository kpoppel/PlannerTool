import { html } from '../../vendor/lit.js';
import { getIconTemplate } from '../../services/IconService.js';

export const SIDEBAR_FILTER_DIMENSIONS = [
  { key: 'schedule', title: 'Schedule', shortcut: 'P', options: [
    { key: 'planned', label: 'Planned' }, { key: 'unplanned', label: 'Unplanned' },
  ] },
  { key: 'allocation', title: 'Allocation', shortcut: 'A', options: [
    { key: 'allocated', label: 'Allocated' }, { key: 'unallocated', label: 'Unallocated' },
  ] },
  { key: 'hierarchy', title: 'Hierarchy', shortcut: 'I', options: [
    { key: 'hasParent', label: 'Has Parent' }, { key: 'noParent', label: 'No Parent' },
  ] },
  { key: 'relations', title: 'Relations', shortcut: 'R', options: [
    { key: 'hasLinks', label: 'Has Links' }, { key: 'noLinks', label: 'No Links' },
  ] },
];

/** Render only projected values and dispatch named, value-based actions. */
export function renderSidebarTaskFilters({ model, actions }) {
  return html`
    <div class="filter-dimensions" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      ${model.dimensions.map((dimension) => html`
        <div class="filter-dimension">
          <div class="filter-dimension-title shortcut-heading">${dimension.title}
            <kbd class="shortcut-pill" title=${`Cycle ${dimension.title} (${dimension.shortcut})`}>${dimension.shortcut}</kbd>
          </div>
          <div class="filter-options" style="display:flex;flex-direction:column;gap:6px;">
            ${dimension.options.map((option) => html`
              <div class="filter-option ${option.active ? 'active' : ''} ${option.disabled ? 'disabled' : ''}"
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
    ${model.states.length === 0 && model.types.length === 0 ? html`
      <div class="section-description"><span class="small">No filters available</span></div>
    ` : ''}
    ${model.states.length > 0 ? html`
      <div class="filter-dimension">
        <div class="filter-dimension-title">State</div>
        <div class="filter-options">
          ${model.states.map((state) => html`
            <div class="filter-option ${state.active ? 'active' : ''} ${state.disabled ? 'disabled' : ''}"
              aria-disabled=${state.disabled ? 'true' : 'false'}
              @click=${() => { if (!state.disabled) actions.toggleState(state.name); }}
              title=${state.disabled ? 'Not relevant in current tool context' : ''}>
              <div style="display:inline-flex;align-items:center;gap:8px;flex:1;">
                <span class="filter-state-dot"
                  style="width:14px;height:14px;border-radius:3px;display:inline-block;background:${state.color};border:1px solid rgba(0,0,0,0.06);box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);"
                ></span>
                <div style="flex:1;color:#fff;">${state.name}</div>
              </div>
              <div class="filter-checkbox" style="margin-left:8px;${state.active ?
                'background: rgba(102, 126, 234, 0.8); border-color: rgba(102, 126, 234, 1);' : ''}"></div>
            </div>
          `)}
        </div>
      </div>
    ` : ''}
    ${model.types.length > 0 ? html`
      <div class="filter-dimension">
        <div class="filter-dimension-title">Task Types</div>
        <div class="filter-options">
          ${model.types.map((type) => html`
            <div class="filter-option ${type.active ? 'active' : ''} ${type.disabled ? 'disabled' : ''}"
              aria-disabled=${type.disabled ? 'true' : 'false'}
              @click=${() => { if (!type.disabled) actions.toggleType(type.name); }}
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
  `;
}