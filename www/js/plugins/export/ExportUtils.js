/**
 * Export utility functions
 * Provides SVG creation and PNG export helpers
 */

/**
 * Get bounds of the visible timeline viewport
 * Queries the DOM to find timeline elements and calculate their bounds
 * @param {Object} options - Optional overrides
 * @param {number} options.scrollLeft - Override horizontal scroll position
 * @param {number} options.scrollTop - Override vertical scroll position
 * @returns {Object} - { x, y, width, height, scrollLeft, scrollTop, totalWidth, totalHeight, mainGraphHeight, fullHeight }
 */
export function getViewportBounds(options = {}) {
    const timelineSection = document.getElementById('timelineSection');
    const featureBoard = document.querySelector('feature-board');
    const mainGraph = document.querySelector('maingraph-lit');
    
    if (!timelineSection || !featureBoard) {
        console.warn('[Export] Missing elements:', { timelineSection: !!timelineSection, featureBoard: !!featureBoard });
        return { 
            x: 0, y: 0, width: 0, height: 0, 
            scrollLeft: 0, scrollTop: 0, 
            totalWidth: 0, totalHeight: 0,
            mainGraphHeight: 0, fullHeight: 0
        };
    }
    
    const rect = timelineSection.getBoundingClientRect();
    const boardRect = featureBoard.getBoundingClientRect();
    const mainGraphRect = mainGraph ? mainGraph.getBoundingClientRect() : { height: 0 };
    
    // IMPORTANT: Horizontal scroll is on timelineSection, vertical scroll is on featureBoard
    // This matches the panning behavior in Timeline.lit.js
    const scrollLeft = options.scrollLeft !== undefined ? options.scrollLeft : (timelineSection.scrollLeft || 0);
    const scrollTop = options.scrollTop !== undefined ? options.scrollTop : (featureBoard.scrollTop || 0);
    const totalWidth = featureBoard.scrollWidth || boardRect.width;
    const totalHeight = featureBoard.scrollHeight || boardRect.height;
    
    return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        scrollLeft,
        scrollTop,
        totalWidth,
        totalHeight,
        mainGraphHeight: mainGraphRect.height,
        fullHeight: totalHeight
    };
}

/**
 * Create an SVG element with namespace
 * @param {string} tag - SVG tag name
 * @param {Object} attrs - Attributes to set
 * @returns {SVGElement}
 */
export function createSvgElement(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) {
        el.setAttribute(key, value);
    }
    return el;
}

/**
 * Create SVG text element
 * @param {string} text - Text content
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {Object} attrs - Additional attributes
 * @returns {SVGTextElement}
 */
export function createSvgText(text, x, y, attrs = {}) {
    const el = createSvgElement('text', {
        x: String(x),
        y: String(y),
        ...attrs
    });
    el.textContent = text;
    return el;
}

/**
 * Wrap text into multiple lines for SVG
 * @param {string} text - Text to wrap
 * @param {number} maxWidth - Maximum width in pixels
 * @param {number} fontSize - Font size in pixels
 * @returns {string[]} - Array of text lines
 */
export function wrapText(text, maxWidth, fontSize = 12) {
    if (!text) return [];
    
    // Approximate characters per line based on font size
    const avgCharWidth = fontSize * 0.6;
    const charsPerLine = Math.floor(maxWidth / avgCharWidth);
    
    if (charsPerLine <= 0) return [text];
    
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    
    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (testLine.length <= charsPerLine) {
            currentLine = testLine;
        } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
        }
    }
    
    if (currentLine) lines.push(currentLine);
    return lines;
}

/**
 * Generate a filename for export
 * @param {string} prefix - Filename prefix
 * @param {string} extension - File extension (without dot)
 * @returns {string}
 */
export function generateFilename(prefix = 'timeline', extension = 'png') {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${prefix}-${timestamp}.${extension}`;
}

/**
 * Convert SVG element to PNG blob
 * @param {SVGElement} svg - The SVG element to convert
 * @param {number} width - Output width
 * @param {number} height - Output height
 * @param {number} scale - Scale factor for resolution (default 2 for retina)
 * @returns {Promise<Blob>}
 */
export async function svgToPngBlob(svg, width, height, scale = 2) {
    return new Promise((resolve, reject) => {
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(svg);
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = width * scale;
            canvas.height = height * scale;
            
            const ctx = canvas.getContext('2d');
            ctx.scale(scale, scale);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            
            URL.revokeObjectURL(url);
            
            canvas.toBlob(blob => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Failed to create PNG blob'));
                }
            }, 'image/png');
        };
        
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load SVG as image'));
        };
        
        img.src = url;
    });
}

/**
 * Download a blob as a file
 * @param {Blob} blob - The blob to download
 * @param {string} filename - The filename to use
 */
export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
