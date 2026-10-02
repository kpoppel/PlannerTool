import { html } from '../../vendor/lit.js';

/** Render tag presentation and dispatch draft values through explicit actions. */
export function renderDetailsPanelTags({ model, actions }) {
  const { tags, changed, originalTags, newTagText } = model;
  const tagsCls = changed ? 'details-value details-changed' : 'details-value';
  return html`
    <div class="tags-section">
      <div class="details-label">Tags</div>
      <div class="${tagsCls}">
        <div class="tags-row">
          ${tags.length ?
            tags.map((tag) => html`
              <span class="tag-chip">
                <span>${tag}</span>
                <button type="button" title="Remove tag ${tag}" @click=${() => actions.removeTag(tag)}>✕</button>
              </span>
            `)
          : html`<span>—</span>`}
          ${changed ? html`<span class="original-date">(was ${originalTags ? originalTags : '—'})</span>` : ''}
        </div>
        <div class="tag-editor-row">
          <input
            type="text"
            class="tag-input"
            .value=${newTagText}
            placeholder="Add tag"
            @input=${(event) => actions.changeDraft(event.target.value)}
            @keydown=${(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault();
                actions.addTag();
              }
            }}
          />
          <button type="button" class="tag-add-btn" @click=${actions.addTag}>Add</button>
        </div>
      </div>
    </div>
  `;
}
