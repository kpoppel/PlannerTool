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

const USERSTORY_SVG_CORE = `
  <svg width="24px" height="24px" viewBox="0 0 36.958244 25.315945"  xmlns="http://www.w3.org/2000/svg">
      <path fill-rule="evenodd" fill="#28a745" fill-opacity="1" 
        d="M 19.672583,4.6001506 V 24.900332 
        c 3.164358,-2.507578 7.284241,-3.880808 11.762349,-3.880808 1.074481,0 2.029719,0.05967 3.044819,0.238785 V 0.48055729 
        C 33.524516,0.30144461 32.569087,0.30144461 31.434932,0.30144461 26.837287,0.3611169 22.538579,1.9135556 19.672583,4.6001506 Z M 31.434932,22.273217 
        c -4.060211,2.79e-4 -7.821868,1.194215 -10.747441,3.343664 H 37.584532 V 5.4362353 H 35.67406 V 22.034528 
        c 0,0.179115 -0.05986,0.358226 -0.238977,0.477765 -0.119536,0.119247 -0.298458,0.179015 -0.477762,0.119247 -1.134446,-0.238786 -2.268793,-0.358323 -3.522389,-0.358323 z m -14.031046,3.343664 
        c -2.806419,-2.149449 -6.687132,-3.34347 -10.6277088,-3.34347 -1.2539817,0 -2.3882342,0.119343 -3.5226789,0.358129 -0.179209,0.05977 -0.3583218,0 -0.4776661,-0.119247 
        C 2.6563915,22.392754 2.5370473,22.213643 2.5370473,22.034624 V 5.4364275 L 0.62628623,5.4362319 V 25.616881 Z m 1.074677,-0.716453 V 4.6004393 
        C 15.67224,1.9135556 11.49278,0.36130929 6.8357531,0.36130929 c -1.1344449,0 -2.0896807,0 -3.0449167,0.17911277 V 21.318174 
        c 0.955236,-0.179208 1.9702402,-0.238976 3.0449167,-0.238976 4.4182419,0 8.5977019,1.373326 11.6428099,3.82123"
      id="path2" style="stroke-width:0.0246388" />
  </svg>`;

  const INITIATIVE_SVG_CORE = `
<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(-82.285416,-93.397915)">
    <path
      d="m 93.967358,97.849942 c 0.570709,1.357883 0.900335,2.627208 0.988892,3.807978 0.08856,1.18076 -0.103317,1.86955 
      -0.575624,2.06634 -0.275517,0.11808 -0.575624,0.10332 -0.900335,-0.0443 -0.324711,-0.1476 -0.644507,-0.34438 
      -0.959373,-0.59038 -0.314866,-0.246 -0.801933,-0.44771 -1.4612,-0.60515 -0.659266,-0.15744 -1.392316,-0.19679 
      -2.199179,-0.11807 -0.275517,0.0394 -0.482151,0.13283 -0.619902,0.28043 -0.137752,0.1476 -0.167271,0.32963 
      -0.08856,0.5461 0.216479,0.55102 0.442788,1.08237 0.678941,1.59404 0.03936,0.0984 0.157441,0.20663 0.35423,0.32471
      0.19679,0.11808 0.314867,0.21648 0.354231,0.29519 0.137751,0.33456 0.02952,0.56087 -0.324711,0.67894 -0.491982,0.21648
      -0.993808,0.41327 -1.505479,0.59039 -0.295191,0.0984 -0.560864,-0.10823 -0.797017,-0.61991 -0.314867,-0.74782 
      -0.600229,-1.39724 -0.856057,-1.94826 -0.05904,-0.11808 -0.226308,-0.20172 -0.501826,-0.25091 -0.275517,-0.0492
      -0.501826,-0.20172 -0.678941,-0.45755 -0.295192,0.0984 -0.482151,0.16727 -0.560864,0.20663 -0.334556,0.11808
      -0.698616,0.059 -1.09221,-0.17711 -0.393594,-0.23616 -0.659266,-0.53135 -0.797018,-0.88558 -0.15744,-0.31486
      -0.18203,-0.70354 -0.0738,-1.16601 0.108232,-0.46246 0.319796,-0.76258 0.634663,-0.90033 1.239805,-0.511671
      2.287736,-1.043016 3.143792,-1.594036 0.856056,-0.55102 1.466115,-1.057776 1.830189,-1.520238 0.364075,-0.462462
      0.654337,-0.915095 0.870816,-1.357882 0.216479,-0.442788 0.339471,-0.826537 0.36899,-1.151248 0.02952,-0.324711 
      0.103317,-0.614988 0.221394,-0.870816 0.118077,-0.255828 0.295192,-0.432943 0.531345,-0.531345 0.472307,-0.19679 
      1.111884,0.147596 1.918747,1.033171 0.806862,0.885575 1.505478,2.007304 2.095862,3.365186 0,0 0,0 0,0 
      m -0.413269,4.427878 c 0.07871,-0.0394 0.127922,-0.22631 0.147596,-0.56086 0.01967,-0.33456 -0.03443,-0.8167
      -0.162356,-1.44644 -0.127921,-0.629752 -0.329625,-1.259485 -0.605143,-1.889232 -0.275517,-0.649422 -0.605143,-1.254565
      -0.988892,-1.81543 -0.38375,-0.560864 -0.713375,-0.974133 -0.988893,-1.239805 -0.275517,-0.265673 -0.452632,-0.378835 
      -0.531345,-0.339471 -0.07871,0.03936 -0.127921,0.245998 -0.147596,0.619903 -0.01967,0.373905 0.02952,0.89049
      0.147596,1.549757 0.118077,0.659266 0.314866,1.313603 0.590384,1.963025 0.275517,0.649422 0.610058,1.234893 
      1.003652,1.756393 0.393594,0.5215 0.728135,0.89542 1.003652,1.12173 0.275517,0.22631 0.452632,0.31979
      0.531345,0.28043 0,0 0,0 0,0"
      id="path1"
      style="stroke-width:0.0147596;fill:#ffcc00" />
  </g>
</svg>
`;

// Lit template versions (for use directly inside components)
export const initiativeTemplate = html`${unsafeSVG(INITIATIVE_SVG_CORE)}`;

export const epicTemplate = html`${unsafeSVG(EPIC_SVG_CORE)}`;
export const featureTemplate = html`${unsafeSVG(FEATURE_SVG_CORE)}`;

export const userstoryTemplate = html`${unsafeSVG(USERSTORY_SVG_CORE)}`;

export const defaultTemplate = html`${unsafeSVG(DEFAULT_SVG_CORE)}`;

// Return an SVGElement ready to be inserted into an export SVG.
// Accepts an attrs object to set basic positioning/size attributes.
// TODO: Only used ina test: iconservice.test.js
export function epicSvgElement(attrs = {}) {
  const el = parseSvgString(EPIC_SVG_CORE);
  if (!el) return null;
  if (attrs.x !== undefined) el.setAttribute('x', String(attrs.x));
  if (attrs.y !== undefined) el.setAttribute('y', String(attrs.y));
  if (attrs.width !== undefined) el.setAttribute('width', String(attrs.width));
  if (attrs.height !== undefined) el.setAttribute('height', String(attrs.height));
  return el;
}

// TODO: Only used ina test: iconservice.test.js
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
  initiative: initiativeTemplate,
  epic: epicTemplate,
  feature: featureTemplate,
  "user story": userstoryTemplate,
};

// Map of lower-cased type name → SVG core string (for DOM element export)
const ICON_SVG_CORE_MAP = {
  initiative: INITIATIVE_SVG_CORE,
  epic: EPIC_SVG_CORE,
  feature: FEATURE_SVG_CORE,
  "user story": USERSTORY_SVG_CORE,
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
  initiativeTemplate,
  epicTemplate,
  featureTemplate,
  userstoryTemplate,
  defaultTemplate,
  featureSvgElement,
  epicSvgElement,
  getIconTemplate,
  getIconSvgElement,
};
