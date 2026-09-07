import { html } from '../../vendor/lit.js';

export function renderDetailsPanelScheduling({ host, feature, iterations, childrenByParent, orig }) {
  const startOrig = orig.start;
  const endOrig = orig.end;
  const startChanged = startOrig !== undefined && feature.start !== startOrig;
  const endChanged = endOrig !== undefined && feature.end !== endOrig;
  const hasAnyDate = !!(feature.start || feature.end);
  const hasChildren =
    feature &&
    feature.type &&
    childrenByParent &&
    (childrenByParent.has(String(feature.id)) || childrenByParent.has(feature.id));

  const selectedPath = feature.iterationPath || '';
  const selectedIter = selectedPath ?
    (iterations || []).find(
      (it) =>
        it.path === selectedPath ||
        (it.path && it.path.endsWith(selectedPath)) ||
        selectedPath.endsWith(it.path)
    )
  : null;
  const datesOverride = !!(selectedIter && hasAnyDate && (
    !selectedIter.startDate ||
    !selectedIter.finishDate ||
    selectedIter.startDate.slice(0, 10) !== feature.start ||
    selectedIter.finishDate.slice(0, 10) !== feature.end
  ));
  const iterationDirty = orig.iterationPath !== undefined &&
    feature.iterationPath !== orig.iterationPath;

  const startTitle = startChanged ? `was ${startOrig}` : 'Start date';
  const endTitle = endChanged ? `was ${endOrig}` : 'End date';

  const typeLabel =
    feature.type ?
      feature.type.charAt(0).toUpperCase() + feature.type.slice(1)
    : 'Item';

  const today = new Date().toISOString().slice(0, 10);
  const currentAndFutureIterations = [];
  const pastIterations = [];
  for (const iteration of iterations || []) {
    const finishDate = iteration.finishDate ? iteration.finishDate.slice(0, 10) : null;
    if (!finishDate || finishDate >= today) {
      currentAndFutureIterations.push(iteration);
    } else {
      pastIterations.push(iteration);
    }
  }
  const renderIterationGroup = (label, group) => group.length ? html`
    <optgroup label=${label}>
      ${group.map((it) => html`<option value="${it.path}">${host._formatIterationLabel(it)}</option>`)}
    </optgroup>
  ` : '';

  return html`
    <div class="details-label" style="margin-top:8px;">Scheduling</div>
    <div style="margin-top:4px;">
      <select
        class="iteration-select${iterationDirty ? ' iteration-dirty' : ''}${datesOverride ? ' dates-override' : ''}"
        .value=${selectedPath}
        @change=${(e) => host._onIterationChange(e)}
        title=${iterationDirty && datesOverride ?
          `Changed from '${orig.iterationPath || '—'}' — dates also differ from this iteration's bounds`
        : iterationDirty ?
          `Changed from '${orig.iterationPath || '—'}'`
        : datesOverride ?
          'Dates have been overridden — they differ from this iteration\'s bounds'
        : 'Pick a sprint to fill the dates below'}
      >
        <option value="">—</option>
        ${iterations && iterations.length ?
          html`
            ${renderIterationGroup('Current and future iterations', currentAndFutureIterations)}
            ${renderIterationGroup('Past iterations', pastIterations)}
          `
        : html`<option disabled>No iterations available</option>`}
      </select>
    </div>
    <div class="date-row" style="margin-top:6px;">
      <input
        type="date"
        class="date-input${startChanged ? ' details-changed' : ''}"
        .value=${feature.start || ''}
        title=${startTitle}
        @change=${(e) => host._onStartDateChange(e)}
      />
      <span class="date-sep">→</span>
      <input
        type="date"
        class="date-input${endChanged ? ' details-changed' : ''}"
        .value=${feature.end || ''}
        title=${endTitle}
        @change=${(e) => host._onEndDateChange(e)}
      />
    </div>
    ${hasChildren || hasAnyDate ?
      html`<div class="date-toolbar">
        ${hasChildren ?
          html`
            <button
              class="date-tool-btn"
              @click=${(e) => host._snapStartDate(e)}
              title="Snap start to earliest child"
              aria-label="Snap start to earliest child"
            >⇤</button>
            <button
              class="date-tool-btn"
              data-test="shrinkwrap-chip"
              @click=${(e) => host._shrinkwrapEpic(e)}
              title="Shrink ${typeLabel} to span of children"
              aria-label="Shrink ${typeLabel} to children"
            ><svg width="18" height="14" viewBox="0 0 20 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
                <rect x="0.5" y="0.5" width="3" height="15" fill="currentColor"/>
                <rect x="16.5" y="0.5" width="3" height="15" fill="currentColor"/>
                <polygon points="6.5,4 10,8 6.5,12" fill="currentColor"/>
                <polygon points="13.5,4 10,8 13.5,12" fill="currentColor"/>
                <rect x="9" y="7.2" width="2" height="1.6" fill="currentColor"/>
              </svg></button>
            <button
              class="date-tool-btn"
              @click=${(e) => host._snapEndDate(e)}
              title="Snap end to latest child"
              aria-label="Snap end to latest child"
            >⇥</button>
            ${hasAnyDate ? html`<span class="date-tool-sep"></span>` : ''}
          `
        : ''}
        ${hasAnyDate ?
          html`<button
            class="clear-dates-btn"
            @click=${() => host._clearDates()}
            title="Remove dates — task becomes unplanned"
          >✕ Clear dates</button>`
        : ''}
      </div>`
    : ''}
  `;
}
