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

// Action icons for menus
const SAVE_SVG_CORE = `
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="#4285f4" stroke="none">
      <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
    </g>
  </svg>
`;

const CLONE_SVG_CORE = `
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="#5f6368" stroke="none">
      <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
    </g>
  </svg>
`;

const EDIT_SVG_CORE = `
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="#f9ab00" stroke="none">
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
    </g>
  </svg>
`;

const DELETE_SVG_CORE = `
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="#ea4335" stroke="none">
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
    </g>
  </svg>
`;

const REFRESH_SVG_CORE = `
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="#34a853" stroke="none">
      <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
    </g>
  </svg>
`;

const CLOUD_SVG_CORE = `
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g fill="#4285f4" stroke="none">
      <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
    </g>
  </svg>
`;

// Lit template versions (for use directly inside components)
export const epicTemplate = html`${unsafeSVG(EPIC_SVG_CORE)}`;

export const featureTemplate = html`${unsafeSVG(FEATURE_SVG_CORE)}`;

export const saveIconTemplate = html`${unsafeSVG(SAVE_SVG_CORE)}`;
export const cloneIconTemplate = html`${unsafeSVG(CLONE_SVG_CORE)}`;
export const editIconTemplate = html`${unsafeSVG(EDIT_SVG_CORE)}`;
export const deleteIconTemplate = html`${unsafeSVG(DELETE_SVG_CORE)}`;
export const refreshIconTemplate = html`${unsafeSVG(REFRESH_SVG_CORE)}`;
export const cloudIconTemplate = html`${unsafeSVG(CLOUD_SVG_CORE)}`;

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
  epicSvgElement,
  saveIconTemplate,
  cloneIconTemplate,
  editIconTemplate,
  deleteIconTemplate,
  refreshIconTemplate,
  cloudIconTemplate
};
