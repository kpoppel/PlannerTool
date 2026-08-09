import { html } from '../../vendor/lit.js';

export function renderDetailsPanelRelations({ relationsTemplate }) {
  return html`
    <div class="details-label">Links:</div>
    <div class="details-value">${relationsTemplate}</div>
  `;
}
