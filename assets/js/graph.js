/* ===========================================
   Adamus - Interactive Graph Module
   SVG-based coordinate system for math questions
   =========================================== */

import {
  svgEl,
  svgRoot,
  svgLine,
  svgRect,
  svgCircle,
  svgText,
  svgGroup,
  svgPolygon,
  svgPath,
} from "./svg-helpers.js";

/**
 * Create an SVG coordinate system
 */
export function createCoordinateSystem(options = {}) {
  const {
    width = 400,
    height = 400,
    xMin = -6,
    xMax = 6,
    yMin = -6,
    yMax = 6,
    showGrid = true,
    showLabels = true,
    gridStep = 1,
  } = options;

  const padding = 40;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  // Scale functions
  const scaleX = (x) => padding + ((x - xMin) / (xMax - xMin)) * innerWidth;
  const scaleY = (y) => padding + ((yMax - y) / (yMax - yMin)) * innerHeight;

  // Create SVG
  const svg = svgRoot(width, height, { class: "coordinate-system" });
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";

  // Background
  svg.appendChild(svgRect(0, 0, width, height, { fill: "#fafafa", rx: "8" }));

  // Grid lines
  if (showGrid) {
    const gridGroup = svgGroup({ class: "grid", stroke: "#e5e5e5", "stroke-width": "1" });

    // Vertical grid lines
    for (let x = Math.ceil(xMin); x <= Math.floor(xMax); x += gridStep) {
      if (x === 0) continue;
      gridGroup.appendChild(svgLine(scaleX(x), padding, scaleX(x), height - padding));
    }

    // Horizontal grid lines
    for (let y = Math.ceil(yMin); y <= Math.floor(yMax); y += gridStep) {
      if (y === 0) continue;
      gridGroup.appendChild(svgLine(padding, scaleY(y), width - padding, scaleY(y)));
    }

    svg.appendChild(gridGroup);
  }

  // Axes
  const axesGroup = svgGroup({ class: "axes", stroke: "#333", "stroke-width": "2" });
  axesGroup.appendChild(svgLine(padding, scaleY(0), width - padding, scaleY(0))); // X-axis
  axesGroup.appendChild(svgLine(scaleX(0), padding, scaleX(0), height - padding)); // Y-axis

  // Arrow heads
  const arrowSize = 8;
  axesGroup.appendChild(svgPolygon(
    `${width - padding},${scaleY(0)} ${width - padding - arrowSize},${scaleY(0) - arrowSize / 2} ${width - padding - arrowSize},${scaleY(0) + arrowSize / 2}`,
    { fill: "#333" }
  ));
  axesGroup.appendChild(svgPolygon(
    `${scaleX(0)},${padding} ${scaleX(0) - arrowSize / 2},${padding + arrowSize} ${scaleX(0) + arrowSize / 2},${padding + arrowSize}`,
    { fill: "#333" }
  ));

  svg.appendChild(axesGroup);

  // Axis labels
  if (showLabels) {
    const labelsGroup = svgGroup({
      class: "labels",
      "font-family": "Inter, sans-serif",
      "font-size": "12",
      fill: "#666",
    });

    // X-axis labels
    for (let x = Math.ceil(xMin); x <= Math.floor(xMax); x += gridStep) {
      if (x === 0) continue;
      labelsGroup.appendChild(svgText(x, scaleX(x), scaleY(0) + 16, { "text-anchor": "middle" }));
    }

    // Y-axis labels
    for (let y = Math.ceil(yMin); y <= Math.floor(yMax); y += gridStep) {
      if (y === 0) continue;
      labelsGroup.appendChild(svgText(y, scaleX(0) - 8, scaleY(y) + 4, { "text-anchor": "end" }));
    }

    // Origin, X, Y labels
    labelsGroup.appendChild(svgText("O", scaleX(0) - 8, scaleY(0) + 16, { "text-anchor": "end", "font-weight": "600" }));
    labelsGroup.appendChild(svgText("x", width - padding + 5, scaleY(0) + 16, { "font-style": "italic" }));
    labelsGroup.appendChild(svgText("y", scaleX(0) + 10, padding + 5, { "font-style": "italic" }));

    svg.appendChild(labelsGroup);
  }

  // Content group for points and lines
  const contentGroup = svgGroup({ class: "content" });
  svg.appendChild(contentGroup);

  return {
    svg,
    scaleX,
    scaleY,
    contentGroup,

    addPoint(x, y, options = {}) {
      const { color = "#6366f1", radius = 6, label = "", labelOffset = { x: 10, y: -10 } } = options;
      const group = svgGroup({ class: "point" });

      group.appendChild(svgCircle(scaleX(x), scaleY(y), radius, { fill: color }));

      if (label) {
        group.appendChild(svgText(label, scaleX(x) + labelOffset.x, scaleY(y) + labelOffset.y, {
          "font-family": "Inter, sans-serif",
          "font-size": "14",
          "font-weight": "600",
          fill: color,
        }));
      }

      contentGroup.appendChild(group);
      return group;
    },

    addLine(x1, y1, x2, y2, options = {}) {
      const { color = "#6366f1", width = 2, dashed = false } = options;
      const attrs = { stroke: color, "stroke-width": width };
      if (dashed) attrs["stroke-dasharray"] = "5,5";

      const line = svgLine(scaleX(x1), scaleY(y1), scaleX(x2), scaleY(y2), attrs);
      contentGroup.appendChild(line);
      return line;
    },

    addFunction(fn, options = {}) {
      const { color = "#6366f1", width = 2, step = 0.1 } = options;
      let d = "";

      for (let x = xMin; x <= xMax; x += step) {
        const y = fn(x);
        if (y >= yMin && y <= yMax) {
          const px = scaleX(x);
          const py = scaleY(y);
          d += d === "" ? `M ${px} ${py}` : ` L ${px} ${py}`;
        }
      }

      const path = svgPath(d, { stroke: color, "stroke-width": width, fill: "none" });
      contentGroup.appendChild(path);
      return path;
    },

    addPolyline(points, options = {}) {
      const { color = "#c9a227", width = 3, showPoints = true, pointRadius = 5, dashed = false } = options;
      if (!points || points.length < 2) return null;

      let d = "";
      points.forEach((p, i) => {
        const px = scaleX(p[0] ?? p.x);
        const py = scaleY(p[1] ?? p.y);
        d += i === 0 ? `M ${px} ${py}` : ` L ${px} ${py}`;
      });

      const attrs = {
        stroke: color,
        "stroke-width": width,
        fill: "none",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      };
      if (dashed) attrs["stroke-dasharray"] = "8,4";

      const path = svgPath(d, attrs);
      contentGroup.appendChild(path);

      if (showPoints) {
        points.forEach((p) => {
          contentGroup.appendChild(svgCircle(scaleX(p[0] ?? p.x), scaleY(p[1] ?? p.y), pointRadius, { fill: color }));
        });
      }

      return path;
    },

    addCurve(points, options = {}) {
      const { color = "#c9a227", width = 3 } = options;
      if (!points || points.length < 2) return null;

      const pts = points.map((p) => ({ x: scaleX(p.x ?? p[0]), y: scaleY(p.y ?? p[1]) }));
      let d = `M ${pts[0].x} ${pts[0].y}`;

      for (let i = 0; i < pts.length - 1; i++) {
        const midX = (pts[i].x + pts[i + 1].x) / 2;
        const midY = (pts[i].y + pts[i + 1].y) / 2;
        d += ` Q ${pts[i].x} ${pts[i].y} ${midX} ${midY}`;
      }
      d += ` T ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;

      const path = svgPath(d, {
        stroke: color,
        "stroke-width": width,
        fill: "none",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      });
      contentGroup.appendChild(path);
      return path;
    },

    clear() {
      contentGroup.innerHTML = "";
    },
  };
}

/**
 * Render a graph question with image
 */
export function renderGraphQuestion(container, config) {
  const { points = [], lines = [], functions = [], xMin = -6, xMax = 6, yMin = -6, yMax = 6 } = config;

  const graph = createCoordinateSystem({ width: 350, height: 350, xMin, xMax, yMin, yMax });

  points.forEach((p) => graph.addPoint(p.x, p.y, { label: p.label || "", color: p.color || "#6366f1" }));
  lines.forEach((l) => graph.addLine(l.x1, l.y1, l.x2, l.y2, { color: l.color || "#6366f1", dashed: l.dashed || false }));
  functions.forEach((f) => graph.addFunction(f.fn, { color: f.color || "#6366f1" }));

  container.appendChild(graph.svg);
  return graph;
}

/**
 * Create a line graph with custom axes (for time-series data)
 */
export function createLineGraph(options = {}) {
  const {
    width = 400,
    height = 300,
    xMin = 0,
    xMax = 10,
    yMin = 0,
    yMax = 100,
    xStep = 1,
    yStep = 10,
    xLabel = "x",
    yLabel = "y",
    showGrid = true,
  } = options;

  const padding = { top: 30, right: 30, bottom: 50, left: 60 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const scaleX = (x) => padding.left + ((x - xMin) / (xMax - xMin)) * innerWidth;
  const scaleY = (y) => padding.top + ((yMax - y) / (yMax - yMin)) * innerHeight;

  const svg = svgRoot(width, height, { class: "line-graph" });
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";

  svg.appendChild(svgRect(0, 0, width, height, { fill: "#fafafa", rx: "8" }));

  // Grid
  if (showGrid) {
    const gridGroup = svgGroup({ stroke: "#e5e5e5", "stroke-width": "1" });
    for (let x = xMin; x <= xMax; x += xStep) {
      gridGroup.appendChild(svgLine(scaleX(x), padding.top, scaleX(x), height - padding.bottom));
    }
    for (let y = yMin; y <= yMax; y += yStep) {
      gridGroup.appendChild(svgLine(padding.left, scaleY(y), width - padding.right, scaleY(y)));
    }
    svg.appendChild(gridGroup);
  }

  // Axes
  const axesGroup = svgGroup({ stroke: "#333", "stroke-width": "2" });
  axesGroup.appendChild(svgLine(padding.left, height - padding.bottom, width - padding.right, height - padding.bottom));
  axesGroup.appendChild(svgLine(padding.left, padding.top, padding.left, height - padding.bottom));
  svg.appendChild(axesGroup);

  // Labels
  const labelsGroup = svgGroup({ "font-family": "Inter, sans-serif", "font-size": "11", fill: "#666" });

  for (let x = xMin; x <= xMax; x += xStep) {
    labelsGroup.appendChild(svgText(x, scaleX(x), height - padding.bottom + 18, { "text-anchor": "middle" }));
  }
  for (let y = yMin; y <= yMax; y += yStep) {
    labelsGroup.appendChild(svgText(y, padding.left - 8, scaleY(y) + 4, { "text-anchor": "end" }));
  }

  labelsGroup.appendChild(svgText(xLabel, width / 2, height - 8, { "text-anchor": "middle", "font-size": "13", fill: "#333" }));

  const yLabelEl = svgText(yLabel, 15, height / 2, { "text-anchor": "middle", "font-size": "13", fill: "#333" });
  yLabelEl.setAttribute("transform", `rotate(-90, 15, ${height / 2})`);
  labelsGroup.appendChild(yLabelEl);

  svg.appendChild(labelsGroup);

  const contentGroup = svgGroup({ class: "content" });
  svg.appendChild(contentGroup);

  return {
    svg,
    scaleX,
    scaleY,
    contentGroup,

    addPolyline(points, options = {}) {
      const { color = "#c9a227", width = 3, showPoints = true, pointRadius = 5, label = "" } = options;
      if (!points || points.length < 2) return null;

      let d = "";
      points.forEach((p, i) => {
        const px = scaleX(p[0] ?? p.x);
        const py = scaleY(p[1] ?? p.y);
        d += i === 0 ? `M ${px} ${py}` : ` L ${px} ${py}`;
      });

      const path = svgPath(d, {
        stroke: color,
        "stroke-width": width,
        fill: "none",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      });
      contentGroup.appendChild(path);

      if (showPoints) {
        points.forEach((p) => {
          contentGroup.appendChild(svgCircle(scaleX(p[0] ?? p.x), scaleY(p[1] ?? p.y), pointRadius, { fill: color }));
        });
      }

      if (label && points.length > 0) {
        const lastPt = points[points.length - 1];
        contentGroup.appendChild(svgText(label, scaleX(lastPt[0] ?? lastPt.x) + 8, scaleY(lastPt[1] ?? lastPt.y) + 4, {
          "font-family": "Inter, sans-serif",
          "font-size": "12",
          "font-weight": "600",
          fill: color,
        }));
      }

      return path;
    },
  };
}

/**
 * Create a global graph (sketch without exact scale)
 */
export function createGlobalGraph(options = {}) {
  const { width = 350, height = 200, xLabel = "tijd", yLabel = "waarde", xTicks = null } = options;

  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const svg = svgRoot(width, height, { class: "global-graph" });
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";

  svg.appendChild(svgRect(0, 0, width, height, { fill: "#f8f9fa", rx: "8" }));

  // Axes
  const axesGroup = svgGroup({ stroke: "#333", "stroke-width": "2" });
  axesGroup.appendChild(svgLine(padding.left, height - padding.bottom, width - padding.right, height - padding.bottom));
  axesGroup.appendChild(svgLine(padding.left, padding.top, padding.left, height - padding.bottom));

  const arrowSize = 8;
  axesGroup.appendChild(svgPolygon(
    `${width - padding.right},${height - padding.bottom} ${width - padding.right - arrowSize},${height - padding.bottom - arrowSize / 2} ${width - padding.right - arrowSize},${height - padding.bottom + arrowSize / 2}`,
    { fill: "#333" }
  ));
  axesGroup.appendChild(svgPolygon(
    `${padding.left},${padding.top} ${padding.left - arrowSize / 2},${padding.top + arrowSize} ${padding.left + arrowSize / 2},${padding.top + arrowSize}`,
    { fill: "#333" }
  ));
  svg.appendChild(axesGroup);

  // Axis labels
  const labelsGroup = svgGroup({ "font-family": "Inter, sans-serif", "font-size": "13", fill: "#333" });
  labelsGroup.appendChild(svgText(xLabel, width - padding.right + 5, height - padding.bottom + 18));
  labelsGroup.appendChild(svgText(yLabel, padding.left + 5, padding.top - 5));
  svg.appendChild(labelsGroup);

  // X-axis tick marks
  if (xTicks && xTicks.length > 0) {
    const tickGroup = svgGroup({ class: "x-ticks", "font-family": "Inter, sans-serif", "font-size": "11", fill: "#666" });
    const minTick = Math.min(...xTicks);
    const maxTick = Math.max(...xTicks);
    const tickRange = maxTick - minTick;

    xTicks.forEach((tickVal) => {
      const xPos = padding.left + ((tickVal - minTick) / tickRange) * innerWidth;
      tickGroup.appendChild(svgLine(xPos, height - padding.bottom, xPos, height - padding.bottom + 5, { stroke: "#666", "stroke-width": "1" }));
      tickGroup.appendChild(svgText(tickVal, xPos, height - padding.bottom + 17, { "text-anchor": "middle" }));
    });

    svg.appendChild(tickGroup);
  }

  const contentGroup = svgGroup({ class: "content" });
  svg.appendChild(contentGroup);

  return {
    svg,
    contentGroup,
    innerWidth,
    innerHeight,
    padding,

    addCurve(points, options = {}) {
      const { color = "#c9a227", width = 3 } = options;
      if (!points || points.length < 2) return null;

      const xValues = points.map((p) => p.x ?? p[0]);
      const yValues = points.map((p) => p.y ?? p[1]);
      const minX = Math.min(...xValues);
      const maxX = Math.max(...xValues);
      const minY = Math.min(...yValues);
      const maxY = Math.max(...yValues);

      const scaleX = (x) => padding.left + ((x - minX) / (maxX - minX)) * innerWidth;
      const scaleY = (y) => padding.top + ((maxY - y) / (maxY - minY)) * innerHeight;

      const pts = points.map((p) => ({ x: scaleX(p.x ?? p[0]), y: scaleY(p.y ?? p[1]) }));
      let d = `M ${pts[0].x} ${pts[0].y}`;

      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];

        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;

        d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
      }

      const path = svgPath(d, {
        stroke: color,
        "stroke-width": width,
        fill: "none",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      });
      contentGroup.appendChild(path);
      return path;
    },
  };
}
