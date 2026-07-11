/**
 * PluginCostShared
 * Shared UI helpers used by all PluginCost view modules.
 *
 * - renderCountingBanner()   Yellow info banner: active task-type / unplanned rules.
 * - renderClipBanner()       Orange warning banner: features extending outside the
 *                            selected display window so sums are window-restricted.
 */
import { html } from '../vendor/lit.js';
import { state } from '../services/State.js';

/**
 * Yellow banner describing the active counting rules (task types, unplanned
 * inclusion, hierarchy level). Call once per view at the top of the output.
 *
 * @returns {import('lit').TemplateResult|string}
 */
export function renderCountingBanner() {
  try {
    const sidebar = document.querySelector('app-sidebar');
    const tfs = state.taskFilterService;
    const taskFilters = tfs ? tfs.getFilters() : null;
    const showUnplanned = taskFilters ? !!taskFilters.schedule.unplanned : true;
    const selectedTypes =
      sidebar && sidebar.selectedTaskTypes ?
        Array.from(sidebar.selectedTaskTypes).map((s) => String(s))
      : [];
    const typesLabel =
      selectedTypes.length === 0 ? 'All task types' : selectedTypes.join(', ');
    const levelMsg =
      selectedTypes.length > 1 ? 'Children (lowest-level) are authoritative'
      : selectedTypes.length === 1 ? `${selectedTypes[0]} selected`
      : 'All task types';
    const msg = `${typesLabel} · ${showUnplanned ? 'Counting Unplanned work' : 'Excluding Unplanned work'} · ${levelMsg}`;
    return html`<div
      style="margin-bottom:8px;padding:8px;border-radius:6px;background:#fffbe6;border:1px solid #f0e6b6;color:#333;font-size:13px;"
    >
      ${msg}
    </div>`;
  } catch (e) {
    return '';
  }
}

/**
 * Orange warning banner when one or more features extend outside the selected
 * display window. Sums already reflect only the selected window, but the banner
 * makes this explicit to the user.
 *
 * @param {Array<Object>} features - Features to inspect
 * @param {string|null} startDate  - Display window start (YYYY-MM-DD)
 * @param {string|null} endDate    - Display window end   (YYYY-MM-DD)
 * @returns {import('lit').TemplateResult|string}
 */
export function renderClipBanner(features, startDate, endDate) {
  if (!Array.isArray(features) || features.length === 0) return '';
  const clippedCount = features.filter((f) => {
    if (!f) return false;
    const fs = f.start ? String(f.start).slice(0, 10) : null;
    const fe = f.end ? String(f.end).slice(0, 10) : null;
    return (fs && startDate && fs < startDate) || (fe && endDate && fe > endDate);
  }).length;
  if (clippedCount === 0) return '';
  return html`<div
    style="margin-bottom:8px;padding:8px;border-radius:6px;background:#fff3e0;border:1px solid #ffe0b2;color:#e65100;font-size:13px;"
  >
    ⚠ ${clippedCount} feature${clippedCount > 1 ? 's extend' : ' extends'}
    beyond the selected display period. Sums reflect the selected window only.
  </div>`;
}
