import { html } from '../../vendor/lit.js';

export function renderSidebarHierarchy({ model, actions }) {
  if (!model.active) return '';
  const status = model.foldedCount === 0 ? 'All expanded' :
    model.foldedCount === model.foldableCount ? 'All folded' :
    `${model.foldedCount} of ${model.foldableCount} branches folded`;
  return html`
    <div class="hierarchy-fold-group">
      <div class="hierarchy-fold-heading">
        <span class="group-label" id="hierarchy-fold-label">Task hierarchy</span>
        <span class="shortcut-hints">
          <kbd class="shortcut-pill" title="Fold one level (-)">-</kbd>
          <kbd class="shortcut-pill" title="Expand one level (+)">+</kbd>
        </span>
      </div>
      <div class="hierarchy-fold-status" role="status">${status}</div>
      <div class="segmented-group hierarchy-fold-actions" role="group" aria-labelledby="hierarchy-fold-label">
        <button type="button" class="segment-btn" title="Collapse every task hierarchy"
          ?disabled=${model.foldedCount === model.foldableCount}
          @click=${() => actions.fold('collapse-all')}>Fold all</button>
        <button type="button" class="segment-btn" title="Collapse one visible level (-)"
          ?disabled=${!model.canCollapse}
          @click=${() => actions.fold('collapse-one')}>Fold one level</button>
        <button type="button" class="segment-btn" title="Expand one hidden level (+)"
          ?disabled=${model.foldedCount === 0}
          @click=${() => actions.fold('expand-one')}>Expand one level</button>
        <button type="button" class="segment-btn" title="Expand every task hierarchy"
          ?disabled=${model.foldedCount === 0}
          @click=${() => actions.fold('expand-all')}>Expand all</button>
      </div>
    </div>
  `;
}