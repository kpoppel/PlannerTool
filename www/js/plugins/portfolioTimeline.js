import { addDays, addMonths, dateRangeInclusiveMonths, parseDate } from '../components/util.js';

export const TIMELINE_BAR_HEIGHT = 3;
export const TIMELINE_BAR_GAP = 2;
export const TIMELINE_ROW_PADDING = 4;
export const TIMELINE_ROW_MIN_HEIGHT = 20;
export const TIMELINE_HEADER_HEIGHT = 34;
export const TIMELINE_LABEL_WIDTH = 182;
export const TIMELINE_VIEWBOX_WIDTH = 1000;

export function formatTimelineMonthLabel(date) {
  const month = String((date?.getMonth?.() || 0) + 1).padStart(2, '0');
  const year = String(date?.getFullYear?.() || '').padStart(4, '0');
  return `${month}/${year}`;
}

function isValidDate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

function escapeSvgText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rangeToTimelineX(date, rangeStart, rangeEnd, timelineWidth) {
  const spanMs = Math.max(1, rangeEnd.getTime() - rangeStart.getTime());
  const clamped = Math.max(rangeStart.getTime(), Math.min(rangeEnd.getTime(), date.getTime()));
  return ((clamped - rangeStart.getTime()) / spanMs) * timelineWidth;
}

function buildRowBars(features, rangeStart, rangeEnd, totalWidth) {
  const bars = [];
  for (const feature of features) {
    const start = parseDate(feature?.start);
    const end = parseDate(feature?.end);
    if (!isValidDate(start) || !isValidDate(end)) continue;

    const startX = rangeToTimelineX(start, rangeStart, rangeEnd, totalWidth);
    const endX = rangeToTimelineX(addDays(end, 1), rangeStart, rangeEnd, totalWidth);
    const width = Math.max(4, Math.min(totalWidth - startX, endX - startX));
    bars.push({ feature, start, end, startX, width });
  }

  bars.sort((a, b) => {
    const byStart = a.start.getTime() - b.start.getTime();
    if (byStart !== 0) return byStart;
    return a.end.getTime() - b.end.getTime();
  });

  const levels = [];
  for (const bar of bars) {
    let level = 0;
    while (level < levels.length && bar.start.getTime() <= levels[level]) level += 1;
    bar.level = level;
    levels[level] = bar.end.getTime();
  }

  const levelCount = levels.length;
  const height = Math.max(
    TIMELINE_ROW_MIN_HEIGHT,
    TIMELINE_ROW_PADDING * 2 +
      (levelCount > 0 ? levelCount * TIMELINE_BAR_HEIGHT + (levelCount - 1) * TIMELINE_BAR_GAP : 0)
  );

  return { bars, height };
}

export function buildPortfolioTimelineLayout(rows, unallocated, columnStates) {
  const rowsWithFeatures = [];
  const allFeatures = [];

  for (const row of rows || []) {
    const features = [];
    for (const stateName of columnStates || []) {
      for (const entry of row.cells?.[stateName] || []) {
        if (!entry?.feature) continue;
        features.push(entry.feature);
        allFeatures.push(entry.feature);
      }
    }
    rowsWithFeatures.push({ team: row.team, features });
  }

  for (const feature of unallocated || []) allFeatures.push(feature);

  const visibleDates = allFeatures.flatMap((feature) => {
    const start = parseDate(feature?.start);
    const end = parseDate(feature?.end);
    if (!isValidDate(start) || !isValidDate(end)) return [];
    return [start, end];
  });

  if (visibleDates.length === 0) {
    return {
      empty: true,
      rows: [],
      months: [],
      totalWidth: TIMELINE_VIEWBOX_WIDTH,
      totalHeight: TIMELINE_HEADER_HEIGHT,
      stickyOffset: TIMELINE_HEADER_HEIGHT,
      rangeStart: null,
      rangeEnd: null,
    };
  }

  let rangeStart = new Date(Math.min(...visibleDates.map((d) => d.getTime())));
  let rangeEnd = new Date(Math.max(...visibleDates.map((d) => d.getTime())));
  rangeStart = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  rangeEnd = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth() + 1, 0);

  const months = dateRangeInclusiveMonths(rangeStart, rangeEnd);
  const totalWidth = TIMELINE_VIEWBOX_WIDTH;

  const timelineRows = rowsWithFeatures.map((row) => ({
    label: row.team?.name || row.team?.id || 'Unknown Team',
    color: row.team?.color || '#3b82f6',
    ...buildRowBars(row.features, rangeStart, rangeEnd, totalWidth),
  }));

  if ((unallocated || []).length > 0) {
    timelineRows.push({
      label: 'Unallocated',
      color: '#f59e0b',
      ...buildRowBars(unallocated, rangeStart, rangeEnd, totalWidth),
    });
  }

  const totalHeight =
    TIMELINE_HEADER_HEIGHT + timelineRows.reduce((sum, row) => sum + row.height, 0);

  return {
    empty: false,
    rows: timelineRows,
    months,
    totalWidth,
    totalHeight,
    stickyOffset: totalHeight,
    rangeStart,
    rangeEnd,
  };
}

export function buildPortfolioTimelineSvgMarkup(layout, options = {}) {
  if (!layout || layout.empty || !layout.rangeStart || !layout.rangeEnd) return '';

  const getBarColor = options.getBarColor || (() => '#94a3b8');
  const getBarOpacity = options.getBarOpacity || (() => 0.92);
  const getBarTooltip = options.getBarTooltip || (() => '');

  const timelineWidth = Math.max(layout.totalWidth || TIMELINE_VIEWBOX_WIDTH, TIMELINE_LABEL_WIDTH);
  const timelineHeight = layout.totalHeight || TIMELINE_HEADER_HEIGHT;
  const yearRowHeight = 14;
  const monthRowHeight = TIMELINE_HEADER_HEIGHT - yearRowHeight;

  const months = layout.months || [];

  const monthSegments = months.map((month, index) => {
    const startX = rangeToTimelineX(month, layout.rangeStart, layout.rangeEnd, timelineWidth);
    const endX =
      index < months.length - 1
        ? rangeToTimelineX(months[index + 1], layout.rangeStart, layout.rangeEnd, timelineWidth)
        : timelineWidth;
    return {
      month,
      startX,
      endX,
      centerX: startX + Math.max(0, endX - startX) / 2,
      monthNumber: String(month.getMonth() + 1).padStart(2, '0'),
    };
  });

  const yearSegments = [];
  for (const segment of monthSegments) {
    const year = segment.month.getFullYear();
    const last = yearSegments[yearSegments.length - 1];
    if (!last || last.year !== year) {
      yearSegments.push({ year, startX: segment.startX, endX: segment.endX });
    } else {
      last.endX = segment.endX;
    }
  }

  const monthLines = monthSegments
    .map(
      (segment) => `
        <line class="timeline-month-line" x1="${segment.startX}" y1="${yearRowHeight}" x2="${segment.startX}" y2="${timelineHeight}"></line>
      `
    )
    .join('');

  const yearLines = yearSegments
    .map(
      (segment) =>
        `<line class="timeline-year-line" x1="${segment.startX}" y1="0" x2="${segment.startX}" y2="${timelineHeight}"></line>`
    )
    .join('');

  const yearLabels = yearSegments
    .map((segment) => {
      const centerX = segment.startX + Math.max(0, segment.endX - segment.startX) / 2;
      return `<text class="timeline-year-label" x="${centerX}" y="${yearRowHeight / 2 + 4}" text-anchor="middle">${escapeSvgText(segment.year)}</text>`;
    })
    .join('');

  const monthLabels = monthSegments
    .map(
      (segment) =>
        `<text class="timeline-month-number" x="${segment.centerX}" y="${yearRowHeight + monthRowHeight / 2 + 4}" text-anchor="middle">${segment.monthNumber}</text>`
    )
    .join('');

  const rowGroups = (layout.rows || [])
    .map((row, rowIndex) => {
      const rowTop =
        TIMELINE_HEADER_HEIGHT +
        layout.rows.slice(0, rowIndex).reduce((sum, item) => sum + item.height, 0);
      const bars = (row.bars || [])
        .map((bar) => {
          const y = rowTop + TIMELINE_ROW_PADDING + bar.level * (TIMELINE_BAR_HEIGHT + TIMELINE_BAR_GAP);
          const tooltip = escapeSvgText(getBarTooltip(bar.feature));
          return `
            <g>
              <title>${tooltip}</title>
              <rect
                class="timeline-bar"
                x="${bar.startX}"
                y="${y}"
                width="${bar.width}"
                height="${TIMELINE_BAR_HEIGHT}"
                rx="1.5"
                ry="1.5"
                fill="${escapeSvgText(getBarColor(bar.feature))}"
                opacity="${getBarOpacity(bar.feature)}"
              ></rect>
            </g>
          `;
        })
        .join('');
      return `
        <g>
          <line class="timeline-row-divider" x1="0" y1="${rowTop}" x2="${timelineWidth}" y2="${rowTop}"></line>
          ${bars}
        </g>
      `;
    })
    .join('');

  const todayLine = (() => {
    const today = new Date();
    const now = today.getTime();
    const start = layout.rangeStart.getTime();
    const end = layout.rangeEnd.getTime();
    if (now < start || now > end) return '';
    const x = rangeToTimelineX(today, layout.rangeStart, layout.rangeEnd, timelineWidth);
    return `<line class="timeline-today" x1="${x}" y1="0" x2="${x}" y2="${timelineHeight}"></line>`;
  })();

  return `
    <svg class="timeline-svg" viewBox="0 0 ${timelineWidth} ${timelineHeight}" preserveAspectRatio="none" width="100%" height="${timelineHeight}" role="img" aria-label="Portfolio task timeline">
      <rect x="0" y="0" width="${timelineWidth}" height="${timelineHeight}" fill="#fff"></rect>
      <line class="timeline-row-divider" x1="0" y1="${yearRowHeight}" x2="${timelineWidth}" y2="${yearRowHeight}"></line>
      <line class="timeline-row-divider" x1="0" y1="${TIMELINE_HEADER_HEIGHT}" x2="${timelineWidth}" y2="${TIMELINE_HEADER_HEIGHT}"></line>
      ${yearLines}
      ${monthLines}
      ${yearLabels}
      ${monthLabels}
      <line class="timeline-month-line" x1="${timelineWidth}" y1="0" x2="${timelineWidth}" y2="${timelineHeight}"></line>
      ${rowGroups}
      ${todayLine}
    </svg>
  `;
}
