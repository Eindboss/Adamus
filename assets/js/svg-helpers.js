/* ===========================================
   Adamus - SVG Helper Utilities
   Reduces boilerplate for SVG element creation
   =========================================== */

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Create an SVG element with attributes
 * @param {string} tag - SVG element tag (e.g., "rect", "line", "text")
 * @param {Object} attrs - Attributes to set on the element
 * @returns {SVGElement}
 */
export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) {
      el.setAttribute(key, value);
    }
  }
  return el;
}

/**
 * Create an SVG root element with viewBox
 * @param {number} width
 * @param {number} height
 * @param {Object} attrs - Additional attributes
 * @returns {SVGSVGElement}
 */
export function svgRoot(width, height, attrs = {}) {
  return svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`,
    ...attrs
  });
}

/**
 * Create an SVG line element
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {Object} attrs - Additional attributes (stroke, stroke-width, etc.)
 * @returns {SVGLineElement}
 */
export function svgLine(x1, y1, x2, y2, attrs = {}) {
  return svgEl("line", { x1, y1, x2, y2, ...attrs });
}

/**
 * Create an SVG rect element
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {Object} attrs - Additional attributes (fill, rx, ry, etc.)
 * @returns {SVGRectElement}
 */
export function svgRect(x, y, width, height, attrs = {}) {
  return svgEl("rect", { x, y, width, height, ...attrs });
}

/**
 * Create an SVG circle element
 * @param {number} cx - Center x
 * @param {number} cy - Center y
 * @param {number} r - Radius
 * @param {Object} attrs - Additional attributes
 * @returns {SVGCircleElement}
 */
export function svgCircle(cx, cy, r, attrs = {}) {
  return svgEl("circle", { cx, cy, r, ...attrs });
}

/**
 * Create an SVG text element
 * @param {string} content - Text content
 * @param {number} x
 * @param {number} y
 * @param {Object} attrs - Additional attributes
 * @returns {SVGTextElement}
 */
export function svgText(content, x, y, attrs = {}) {
  const el = svgEl("text", { x, y, ...attrs });
  el.textContent = content;
  return el;
}

/**
 * Create an SVG group element
 * @param {Object} attrs - Attributes (class, transform, etc.)
 * @returns {SVGGElement}
 */
export function svgGroup(attrs = {}) {
  return svgEl("g", attrs);
}

/**
 * Create an SVG polygon element
 * @param {string} points - Points string (e.g., "10,10 40,10 40,40")
 * @param {Object} attrs - Additional attributes
 * @returns {SVGPolygonElement}
 */
export function svgPolygon(points, attrs = {}) {
  return svgEl("polygon", { points, ...attrs });
}

/**
 * Create an SVG path element
 * @param {string} d - Path data
 * @param {Object} attrs - Additional attributes
 * @returns {SVGPathElement}
 */
export function svgPath(d, attrs = {}) {
  return svgEl("path", { d, ...attrs });
}
