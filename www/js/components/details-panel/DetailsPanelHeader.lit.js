import { html } from '../../vendor/lit.js';

export function renderDetailsPanelHeader({
  feature,
  planName,
  stateCls,
  stateColor,
  originalStateSpan,
  stateColors,
  availableFeatureStates,
  editingState,
  stateEditValue,
  onClose,
  onStateClick,
  onStateBlur,
  onStateChipSelect,
  getIconTemplate,
}) {
  return html`
    <div class="details-header">
      <button class="details-close" @click=${onClose} aria-label="Close details">✕</button>
      <div class="details-label">
        <span class="title-icon">${getIconTemplate(feature.type)}</span>
        <span>${feature.title}</span>
      </div>
      <div class="details-label">
        ID:
        <a class="details-link" href="${feature.url || '#'}" target="_blank">⤴ ${feature.id}</a>
      </div>
      <div class="details-label">
        Status:
        ${editingState ?
          html`
            <div class="state-edit-row">
              <div class="state-current-wrapper ${stateCls}">
                ${stateColor ?
                  html`<button
                    class="state-chip"
                    style="background:${stateColor.background}; color:${stateColor.text}; border:none; cursor:default;"
                  >
                    ${feature.state}
                  </button>`
                : html`<button class="state-chip" style="cursor:default;">${feature.state}</button>`}
                ${originalStateSpan}
              </div>
              <div class="state-choices-box ${stateCls}" @blur=${onStateBlur} tabindex="-1">
                <div class="state-choices">
                  ${availableFeatureStates.map((s) => {
                    const sc = stateColors && stateColors[s] ? stateColors[s] : null;
                    const isSelected = s === (stateEditValue || feature.state);
                    const selClass = isSelected ? 'selected' : '';
                    return html`<button
                      class="state-chip ${selClass}"
                      style="background:${sc ? sc.background : '#efefef'}; color:${sc ? sc.text : '#222'}; border:${isSelected ?
                        '2px solid rgba(0,0,0,0.14)'
                      : '1px solid rgba(0,0,0,0.08)'}; cursor:pointer;"
                      @click=${() => onStateChipSelect(s)}
                    >
                      ${s}
                    </button>`;
                  })}
                </div>
              </div>
            </div>
          `
        : html`
            <span class="${stateCls}" style="display:inline-flex;gap:8px;align-items:center;">
              ${stateColor ?
                html`<button
                  class="state-chip"
                  style="background:${stateColor.background}; color:${stateColor.text}; border:none; cursor:pointer;"
                  @click=${onStateClick}
                >
                  ${feature.state}
                </button>`
              : html`<button class="state-chip" @click=${onStateClick} style="border:none;cursor:pointer;">
                  ${feature.state}
                </button>`}
              ${originalStateSpan}
            </span>
          `}
      </div>
      <div class="details-label">Plan: <span class="details-value">${planName || '—'}</span></div>
    </div>
  `;
}
