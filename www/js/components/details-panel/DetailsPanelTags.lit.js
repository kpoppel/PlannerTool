import { html } from '../../vendor/lit.js';

export function renderDetailsPanelTags({
  host,
  parsedTags,
  tagsCls,
  tagsOriginalSpan,
  newTagText,
}) {
  return html`
    <div class="tags-section">
      <div class="details-label">Tags</div>
      <div class="${tagsCls}">
        <div class="tags-row">
          ${parsedTags.length ?
            parsedTags.map((tag) => html`
              <span class="tag-chip">
                <span>${tag}</span>
                <button type="button" title="Remove tag ${tag}" @click=${() => host._removeTag(tag)}>✕</button>
              </span>
            `)
          : html`<span>—</span>`}
          ${tagsOriginalSpan}
        </div>
        <div class="tag-editor-row">
          <input
            type="text"
            class="tag-input"
            .value=${newTagText}
            placeholder="Add tag"
            @input=${(e) => host._onTagInput(e)}
            @keydown=${(e) => host._onTagInputKeydown(e)}
          />
          <button type="button" class="tag-add-btn" @click=${() => host._addTag()}>Add</button>
        </div>
      </div>
    </div>
  `;
}
