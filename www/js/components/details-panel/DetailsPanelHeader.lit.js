import { html } from '../../vendor/lit.js';
import { getIconTemplate } from '../../services/IconService.js';

/** Render header state from a presentation model and named actions. */
export function renderDetailsPanelHeader({ model, actions }) {
  const {
    feature, planName, stateChanged, originalState, stateColors,
    availableFeatureStates, editingState, stateEditValue,
  } = model;
  const stateCls = stateChanged ? 'details-value details-changed' : 'details-value';
  const stateColor = stateColors[feature.state];
  const originalStateSpan = stateChanged ?
    html`<span class="original-date">(was ${originalState})</span>` : '';
  return html`
    <div class="details-header">
      <button class="details-close" @click=${actions.close} aria-label="Close details">✕</button>
      <div class="details-label">
        <span class="title-icon">${getIconTemplate(feature.type)}</span>
        <span>${feature.title}</span>
      </div>
      <div class="details-label">
        ID:
        <a class="details-link" href=${feature.url} target="_blank">⤴ ${feature.id}</a>
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
              <div class="state-choices-box ${stateCls}" @blur=${actions.blurState} tabindex="-1">
                <div class="state-choices">
                  ${availableFeatureStates.map((s) => {
                    const sc = stateColors[s];
                    const isSelected = s === (stateEditValue === null ? feature.state : stateEditValue);
                    const selClass = isSelected ? 'selected' : '';
                    return html`<button
                      class="state-chip ${selClass}"
                      style="background:${sc ? sc.background : '#efefef'}; color:${sc ? sc.text : '#222'}; border:${isSelected ?
                        '2px solid rgba(0,0,0,0.14)'
                      : '1px solid rgba(0,0,0,0.08)'}; cursor:pointer;"
                      @click=${() => actions.selectState(s)}
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
                  @click=${actions.startStateEdit}
                >
                  ${feature.state}
                </button>`
              : html`<button class="state-chip" @click=${actions.startStateEdit} style="border:none;cursor:pointer;">
                  ${feature.state}
                </button>`}
              ${originalStateSpan}
            </span>
          `}
      </div>
      <div class="details-label">Plan: <span class="details-value">${planName === null ? '—' : planName}</span></div>
    </div>
  `;
}
