import { html } from '../vendor/lit.js';
import { unsafeSVG } from '../vendor/unsafe-svg.js';

// Icon colors are embedded directly in the SVG strings below (keep DRY)

// Lit template versions (for use directly inside components)
// Core SVG strings (single source of truth). The <g> intentionally has no fill here
// so callers can inject the desired color when producing a string or an element.
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

// Return an SVGElement ready to be inserted into an export SVG.
// Accepts an attrs object to set basic positioning/size attributes.
export function epicSvgElement(attrs = {}) {
  const el = parseSvgString(EPIC_SVG_CORE);
  if (!el) return null;
  try {
    if (attrs.x !== undefined) el.setAttribute('x', String(attrs.x));
    if (attrs.y !== undefined) el.setAttribute('y', String(attrs.y));
    if (attrs.width !== undefined) el.setAttribute('width', String(attrs.width));
    if (attrs.height !== undefined) el.setAttribute('height', String(attrs.height));
  } catch (e) { /* ignore */ }
  return el;
}

export function featureSvgElement(attrs = {}) {
  const el = parseSvgString(FEATURE_SVG_CORE);
  if (!el) return null;
  try {
    if (attrs.x !== undefined) el.setAttribute('x', String(attrs.x));
    if (attrs.y !== undefined) el.setAttribute('y', String(attrs.y));
    if (attrs.width !== undefined) el.setAttribute('width', String(attrs.width));
    if (attrs.height !== undefined) el.setAttribute('height', String(attrs.height));
  } catch (e) { /* ignore */ }
  return el;
}

function parseSvgString(svgString) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    return doc.documentElement;
  } catch (e) {
    return null;
  }
}

export default {
  epicTemplate,
  featureTemplate,
  featureSvgElement,
  epicSvgElement
};
