import { html } from '../../vendor/lit.js';

async function commitSchedulingInput(event, action, previousValue) {
  const input = event.target;
  const result = await action(input.value);
  if (result instanceof Array && result.length === 0) input.value = previousValue;
}

/** Bounds from effective children; missing children or unplanned dates do not contribute. */
export function getDetailsPanelChildDateBounds(children) {
  let earliest = null;
  let latest = null;
  for (const child of children) {
    if (!child) continue;
    const start = child.start ? Date.parse(child.start) : NaN;
    const end = child.end ? Date.parse(child.end) : NaN;
    if (!Number.isNaN(start) && (earliest === null || start < earliest)) earliest = start;
    if (!Number.isNaN(end) && (latest === null || end > latest)) latest = end;
  }
  return {
    start: earliest === null ? null : new Date(earliest).toISOString().slice(0, 10),
    end: latest === null ? null : new Date(latest).toISOString().slice(0, 10),
  };
}

/** Project scheduling presentation; today is explicit to make grouping deterministic. */
export function buildDetailsPanelSchedulingModel({ feature, presets, childrenByParent, orig, today }) {
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

  const matches = presets.filter((preset) =>
    preset.start === feature.start && preset.end === feature.end);
  const selectedPresetId = matches.length === 1 ? matches[0].id : '';

  const startTitle = startChanged ? `was ${startOrig}` : 'Start date';
  const endTitle = endChanged ? `was ${endOrig}` : 'End date';

  const typeLabel =
    feature.type ?
      feature.type.charAt(0).toUpperCase() + feature.type.slice(1)
    : 'Item';

  const currentAndFuturePresets = [];
  const pastPresets = [];
  for (const preset of presets) {
    const option = { id: preset.id, label: `${preset.label} (${preset.start} to ${preset.end})` };
    if (preset.end >= today) {
      currentAndFuturePresets.push(option);
    } else {
      pastPresets.push(option);
    }
  }
  return {
    start: feature.start ? feature.start : '',
    end: feature.end ? feature.end : '',
    startChanged, endChanged, startTitle, endTitle,
    hasChildren, hasAnyDate, typeLabel, selectedPresetId,
    currentAndFuturePresets, pastPresets,
  };
}

/** Render scheduling controls with value-based actions, not host-private handlers. */
export function renderDetailsPanelScheduling({ model, actions }) {
  const {
    start, end, startChanged, endChanged, startTitle, endTitle,
    hasChildren, hasAnyDate, typeLabel, selectedPresetId,
    currentAndFuturePresets, pastPresets,
  } = model;
  const renderIterationGroup = (label, group) => group.length ? html`
    <optgroup label=${label}>
      ${group.map((preset) => html`<option value=${preset.id}>${preset.label}</option>`)}
    </optgroup>
  ` : '';

  return html`
    <div class="details-label" style="margin-top:8px;">Scheduling</div>
    <div style="margin-top:4px;">
      <select
        class="iteration-select"
        .value=${selectedPresetId}
        @change=${(event) => commitSchedulingInput(event, actions.selectPreset, selectedPresetId)}
        aria-label="Schedule preset"
        title="Schedule preset"
      >
        <option value="">—</option>
        ${currentAndFuturePresets.length + pastPresets.length > 0 ?
          html`
            ${renderIterationGroup('Current and future', currentAndFuturePresets)}
            ${renderIterationGroup('Past', pastPresets)}
          `
        : html`<option disabled>No date presets available</option>`}
      </select>
    </div>
    <div class="date-row" style="margin-top:6px;">
      <input
        type="date"
        class="date-input${startChanged ? ' details-changed' : ''}"
        .value=${start}
        title=${startTitle}
        @change=${(event) => commitSchedulingInput(event, actions.changeStart, start)}
      />
      <span class="date-sep">→</span>
      <input
        type="date"
        class="date-input${endChanged ? ' details-changed' : ''}"
        .value=${end}
        title=${endTitle}
        @change=${(event) => commitSchedulingInput(event, actions.changeEnd, end)}
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
