import { html, unsafeSVG } from '../vendor/lit.js';

// Icon colors are embedded directly in the SVG strings below (keep DRY)

// Lit template versions (for use directly inside components)
// Core SVG strings (single source of truth). The <g> intentionally has no fill here
// so callers can inject the desired color when producing a string or an element.

// Generic fallback icon — shown for any task type not explicitly recognised.
const DEFAULT_SVG_CORE = `
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="#94a3b8" stroke="#94a3b8">
      <rect x="3" y="3" width="18" height="18" rx="3" ry="3" />
      <rect x="7" y="10" width="10" height="2" rx="1" />
      <rect x="7" y="14" width="7" height="2" rx="1" />
    </g>
  </svg>
`;

const EPIC_SVG_CORE = `
  <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="#E6C36A" stroke="#E6C36A">
      <path d="M10 70 L50 70 L30 30" transform="rotate(-38,10,70)"/>
      <path d="M10 70 L50 70 L30 30" transform=" translate(60,0) rotate(38,50,70)"/>
      <path d="M60 5 L110 70 L10 70 Z" />
      <rect height="20" width="100" y="70" x="10" />
      <rect height="20" width="100" y="100" x="10" />
    </g>
  </svg>
`;

const FEATURE_SVG_CORE = `
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="#8b5cf6" stroke="#8b5cf6">
      <path d="M5 0 H19 C19 3 16 10 12 15 C8 10 5 3 5 0 Z" />
      <rect x="11" y="10" width="2" height="11" />
      <rect x="8" y="21.5" width="8" height="2" rx="1" ry="1" />
    </g>
  </svg>
`;

// Lit template versions (for use directly inside components)
export const epicTemplate = html`${unsafeSVG(EPIC_SVG_CORE)}`;

export const featureTemplate = html`${unsafeSVG(FEATURE_SVG_CORE)}`;

export const defaultTemplate = html`${unsafeSVG(DEFAULT_SVG_CORE)}`;

// Return an SVGElement ready to be inserted into an export SVG.
// Accepts an attrs object to set basic positioning/size attributes.
export function epicSvgElement(attrs = {}) {
  const el = parseSvgString(EPIC_SVG_CORE);
  if (!el) return null;
  if (attrs.x !== undefined) el.setAttribute('x', String(attrs.x));
  if (attrs.y !== undefined) el.setAttribute('y', String(attrs.y));
  if (attrs.width !== undefined) el.setAttribute('width', String(attrs.width));
  if (attrs.height !== undefined) el.setAttribute('height', String(attrs.height));
  return el;
}

export function featureSvgElement(attrs = {}) {
  const el = parseSvgString(FEATURE_SVG_CORE);
  if (!el) return null;
  if (attrs.x !== undefined) el.setAttribute('x', String(attrs.x));
  if (attrs.y !== undefined) el.setAttribute('y', String(attrs.y));
  if (attrs.width !== undefined) el.setAttribute('width', String(attrs.width));
  if (attrs.height !== undefined) el.setAttribute('height', String(attrs.height));
  return el;
}

function parseSvgString(svgString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  return doc.documentElement;
}

// Map of lower-cased type name → Lit template (for dynamic lookup)
const ICON_TEMPLATE_MAP = {
  epic: epicTemplate,
  feature: featureTemplate,
};

// Map of lower-cased type name → SVG core string (for DOM element export)
const ICON_SVG_CORE_MAP = {
  epic: EPIC_SVG_CORE,
  feature: FEATURE_SVG_CORE,
};

/**
 * Return the Lit html template for a given task type name.
 * Falls back to defaultTemplate for any unrecognised type.
 * @param {string} type - Task type name (e.g. 'Epic', 'feature', 'User Story')
 * @returns {import('lit').TemplateResult}
 */
export function getIconTemplate(type) {
  const key = String(type || '').toLowerCase();
  return ICON_TEMPLATE_MAP[key] ?? defaultTemplate;
}

/**
 * Return an SVGElement ready to be inserted into an export SVG.
 * Falls back to the default icon SVG for any unrecognised type.
 * Accepts an attrs object to set basic positioning/size attributes.
 * @param {string} type - Task type name
 * @param {Object} [attrs={}]
 * @returns {SVGElement|null}
 */
export function getIconSvgElement(type, attrs = {}) {
  const key = String(type || '').toLowerCase();
  const svgCore = ICON_SVG_CORE_MAP[key] ?? DEFAULT_SVG_CORE;
  const el = parseSvgString(svgCore);
  if (!el) return null;
  if (attrs.x !== undefined) el.setAttribute('x', String(attrs.x));
  if (attrs.y !== undefined) el.setAttribute('y', String(attrs.y));
  if (attrs.width !== undefined) el.setAttribute('width', String(attrs.width));
  if (attrs.height !== undefined) el.setAttribute('height', String(attrs.height));
  return el;
}

export default {
  epicTemplate,
  featureTemplate,
  defaultTemplate,
  featureSvgElement,
  epicSvgElement,
  getIconTemplate,
  getIconSvgElement,
};
