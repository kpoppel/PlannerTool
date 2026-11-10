import { html } from '../../vendor/lit.js';

export function renderSidebarHierarchy({ model, actions }) {
  if (!model.active) return '';
  const status = model.foldedCount === 0 ? 'All expanded' :
    model.foldedCount === model.foldableCount ? 'All folded' :
    `${model.foldedCount} of ${model.foldableCount} branches folded`;
  return html`
    <div class="hierarchy-fold-group">
      <div class="hierarchy-fold-heading">
        <span class="group-label" id="hierarchy-fold-label">Task branches</span>
        <span class="shortcut-hints">
          <kbd class="shortcut-pill" title="Fold one level (-)">-</kbd>
          <kbd class="shortcut-pill" title="Expand one level (+)">+</kbd>
        </span>
      </div>
      <div class="hierarchy-fold-status" role="status">${status}</div>
      <div class="hierarchy-fold-actions" role="group" aria-labelledby="hierarchy-fold-label">
        <button type="button" class="fold-action" title="Collapse every task hierarchy" aria-label="Collapse all"
          ?disabled=${model.foldedCount === model.foldableCount}
          @click=${() => actions.fold('collapse-all')}><span aria-hidden="true">&#8722;</span>Collapse all</button>
        <button type="button" class="fold-action" title="Collapse one visible level (-)" aria-label="Collapse one level"
          ?disabled=${!model.canCollapse}
          @click=${() => actions.fold('collapse-one')}><span aria-hidden="true">&#8722;</span>Collapse one level</button>
        <button type="button" class="fold-action" title="Expand one hidden level (+)" aria-label="Expand one level"
          ?disabled=${model.foldedCount === 0}
          @click=${() => actions.fold('expand-one')}><span aria-hidden="true">&#43;</span>Expand one level</button>
        <button type="button" class="fold-action" title="Expand every task hierarchy" aria-label="Expand all"
          ?disabled=${model.foldedCount === 0}
          @click=${() => actions.fold('expand-all')}><span aria-hidden="true">&#43;</span>Expand all</button>
      </div>
    </div>
  `;
}