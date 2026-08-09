import { html } from '../../vendor/lit.js';

export function renderDetailsPanelCapacity({ capacityBars, addTeamButton, totalAllocationBox }) {
  return html`
    <div class="capacity-section">
      <div class="details-label">Allocated Capacity:</div>
      <div class="capacity-bars">${capacityBars}</div>
      ${addTeamButton} ${totalAllocationBox}
    </div>
  `;
}
