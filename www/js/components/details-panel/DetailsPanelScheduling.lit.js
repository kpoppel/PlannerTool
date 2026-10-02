import { html } from '../../vendor/lit.js';

/** Project scheduling presentation; today is explicit to make grouping deterministic. */
export function buildDetailsPanelSchedulingModel({ feature, iterations, childrenByParent, orig, today }) {
  const startOrig = orig === undefined ? undefined : orig.start;
  const endOrig = orig === undefined ? undefined : orig.end;
  const startChanged = startOrig !== undefined && feature.start !== startOrig;
  const endChanged = endOrig !== undefined && feature.end !== endOrig;
  const hasAnyDate = !!(feature.start || feature.end);
  const hasChildren =
    feature &&
    feature.type &&
    childrenByParent &&
    (childrenByParent.has(String(feature.id)) || childrenByParent.has(feature.id));

  const selectedPath = feature.iterationPath ? feature.iterationPath : '';
  const selectedIter = selectedPath ?
    iterations.find(
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
  const iterationDirty = orig !== undefined && orig.iterationPath !== undefined &&
    feature.iterationPath !== orig.iterationPath;

  const startTitle = startChanged ? `was ${startOrig}` : 'Start date';
  const endTitle = endChanged ? `was ${endOrig}` : 'End date';

  const typeLabel =
    feature.type ?
      feature.type.charAt(0).toUpperCase() + feature.type.slice(1)
    : 'Item';

  const currentAndFutureIterations = [];
  const pastIterations = [];
  for (const iteration of iterations) {
    const finishDate = iteration.finishDate ? iteration.finishDate.slice(0, 10) : null;
    if (!finishDate || finishDate >= today) {
      currentAndFutureIterations.push({ path: iteration.path, label: formatIterationLabel(iteration) });
    } else {
      pastIterations.push({ path: iteration.path, label: formatIterationLabel(iteration) });
    }
  }
  const originalPath = orig === undefined ? undefined : orig.iterationPath;
  const previousPathLabel = originalPath ? originalPath : '—';
  return {
    start: feature.start ? feature.start : '',
    end: feature.end ? feature.end : '',
    startChanged, endChanged, startTitle, endTitle,
    hasChildren, hasAnyDate, typeLabel, selectedPath, datesOverride, iterationDirty,
    currentAndFutureIterations, pastIterations,
    iterationTitle: iterationDirty && datesOverride ?
      `Changed from '${previousPathLabel}' — dates also differ from this iteration's bounds` :
      iterationDirty ? `Changed from '${previousPathLabel}'` :
      datesOverride ? 'Dates have been overridden — they differ from this iteration\'s bounds' :
      'Pick a sprint to fill the dates below',
  };
}

function formatIterationLabel(iteration) {
  const match = iteration.path.match(/^(.+?)\\Iteration\\(.+)$/);
  const name = iteration.name ? iteration.name : match ? match[2] : iteration.path;
  const start = iteration.startDate ? iteration.startDate.slice(0, 10) : null;
  const end = iteration.finishDate ? iteration.finishDate.slice(0, 10) : null;
  if (start && end) return `${name} (${start} to ${end})`;
  if (start) return `${name} (from ${start})`;
  if (end) return `${name} (until ${end})`;
  return name;
}

/** Render scheduling controls with value-based actions, not host-private handlers. */
export function renderDetailsPanelScheduling({ model, actions }) {
  const {
    start, end, startChanged, endChanged, startTitle, endTitle,
    hasChildren, hasAnyDate, typeLabel, selectedPath, datesOverride, iterationDirty,
    currentAndFutureIterations, pastIterations, iterationTitle,
  } = model;
  const renderIterationGroup = (label, group) => group.length ? html`
    <optgroup label=${label}>
      ${group.map((iteration) => html`<option value=${iteration.path}>${iteration.label}</option>`)}
    </optgroup>
  ` : '';

  return html`
    <div class="details-label" style="margin-top:8px;">Scheduling</div>
    <div style="margin-top:4px;">
      <select
        class="iteration-select${iterationDirty ? ' iteration-dirty' : ''}${datesOverride ? ' dates-override' : ''}"
        .value=${selectedPath}
        @change=${(event) => actions.selectIteration(event.target.value)}
        title=${iterationTitle}
      >
        <option value="">—</option>
        ${currentAndFutureIterations.length + pastIterations.length > 0 ?
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
        .value=${start}
        title=${startTitle}
        @change=${(event) => actions.changeStart(event.target.value)}
      />
      <span class="date-sep">→</span>
      <input
        type="date"
        class="date-input${endChanged ? ' details-changed' : ''}"
        .value=${end}
        title=${endTitle}
        @change=${(event) => actions.changeEnd(event.target.value)}
      />
    </div>
    ${hasChildren || hasAnyDate ?
      html`<div class="date-toolbar">
        ${hasChildren ?
          html`
            <button
              class="date-tool-btn"
              @click=${(event) => { event.stopPropagation(); actions.snapStart(); }}
              title="Snap start to earliest child"
              aria-label="Snap start to earliest child"
            >⇤</button>
            <button
              class="date-tool-btn"
              data-test="shrinkwrap-chip"
              @click=${(event) => { event.stopPropagation(); actions.fitChildren(); }}
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
              @click=${(event) => { event.stopPropagation(); actions.snapEnd(); }}
              title="Snap end to latest child"
              aria-label="Snap end to latest child"
            >⇥</button>
            ${hasAnyDate ? html`<span class="date-tool-sep"></span>` : ''}
          `
        : ''}
        ${hasAnyDate ?
          html`<button
            class="clear-dates-btn"
            @click=${actions.clearDates}
            title="Remove dates — task becomes unplanned"
          >✕ Clear dates</button>`
        : ''}
      </div>`
    : ''}
  `;
}
