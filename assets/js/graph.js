/* ===========================================
   Adamus - Interactive Graph Module
   SVG-based coordinate system for math questions
   =========================================== */

/**
 * Create an SVG coordinate system
 * @param {Object} options
 * @param {number} options.width - SVG width
 * @param {number} options.height - SVG height
 * @param {number} options.xMin - Minimum x value
 * @param {number} options.xMax - Maximum x value
 * @param {number} options.yMin - Minimum y value
 * @param {number} options.yMax - Maximum y value
 * @param {boolean} options.showGrid - Show grid lines
 * @param {boolean} options.showLabels - Show axis labels
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
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "coordinate-system");
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";

  // Background
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", width);
  bg.setAttribute("height", height);
  bg.setAttribute("fill", "#fafafa");
  bg.setAttribute("rx", "8");
  svg.appendChild(bg);

  // Grid lines
  if (showGrid) {
    const gridGroup = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "g",
    );
    gridGroup.setAttribute("class", "grid");
    gridGroup.setAttribute("stroke", "#e5e5e5");
    gridGroup.setAttribute("stroke-width", "1");

    // Vertical grid lines
    for (let x = Math.ceil(xMin); x <= Math.floor(xMax); x += gridStep) {
      if (x === 0) continue; // Skip axis
      const line = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      line.setAttribute("x1", scaleX(x));
      line.setAttribute("y1", padding);
      line.setAttribute("x2", scaleX(x));
      line.setAttribute("y2", height - padding);
      gridGroup.appendChild(line);
    }

    // Horizontal grid lines
    for (let y = Math.ceil(yMin); y <= Math.floor(yMax); y += gridStep) {
      if (y === 0) continue; // Skip axis
      const line = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      line.setAttribute("x1", padding);
      line.setAttribute("y1", scaleY(y));
      line.setAttribute("x2", width - padding);
      line.setAttribute("y2", scaleY(y));
      gridGroup.appendChild(line);
    }

    svg.appendChild(gridGroup);
  }

  // Axes
  const axesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  axesGroup.setAttribute("class", "axes");
  axesGroup.setAttribute("stroke", "#333");
  axesGroup.setAttribute("stroke-width", "2");

  // X-axis
  const xAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  xAxis.setAttribute("x1", padding);
  xAxis.setAttribute("y1", scaleY(0));
  xAxis.setAttribute("x2", width - padding);
  xAxis.setAttribute("y2", scaleY(0));
  axesGroup.appendChild(xAxis);

  // Y-axis
  const yAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  yAxis.setAttribute("x1", scaleX(0));
  yAxis.setAttribute("y1", padding);
  yAxis.setAttribute("x2", scaleX(0));
  yAxis.setAttribute("y2", height - padding);
  axesGroup.appendChild(yAxis);

  // Arrow heads
  const arrowSize = 8;

  // X-axis arrow
  const xArrow = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "polygon",
  );
  xArrow.setAttribute(
    "points",
    `${width - padding},${scaleY(0)} ${width - padding - arrowSize},${scaleY(0) - arrowSize / 2} ${width - padding - arrowSize},${scaleY(0) + arrowSize / 2}`,
  );
  xArrow.setAttribute("fill", "#333");
  axesGroup.appendChild(xArrow);

  // Y-axis arrow
  const yArrow = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "polygon",
  );
  yArrow.setAttribute(
    "points",
    `${scaleX(0)},${padding} ${scaleX(0) - arrowSize / 2},${padding + arrowSize} ${scaleX(0) + arrowSize / 2},${padding + arrowSize}`,
  );
  yArrow.setAttribute("fill", "#333");
  axesGroup.appendChild(yArrow);

  svg.appendChild(axesGroup);

  // Axis labels
  if (showLabels) {
    const labelsGroup = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "g",
    );
    labelsGroup.setAttribute("class", "labels");
    labelsGroup.setAttribute("font-family", "Inter, sans-serif");
    labelsGroup.setAttribute("font-size", "12");
    labelsGroup.setAttribute("fill", "#666");

    // X-axis labels
    for (let x = Math.ceil(xMin); x <= Math.floor(xMax); x += gridStep) {
      if (x === 0) continue;
      const label = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text",
      );
      label.setAttribute("x", scaleX(x));
      label.setAttribute("y", scaleY(0) + 16);
      label.setAttribute("text-anchor", "middle");
      label.textContent = x;
      labelsGroup.appendChild(label);
    }

    // Y-axis labels
    for (let y = Math.ceil(yMin); y <= Math.floor(yMax); y += gridStep) {
      if (y === 0) continue;
      const label = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text",
      );
      label.setAttribute("x", scaleX(0) - 8);
      label.setAttribute("y", scaleY(y) + 4);
      label.setAttribute("text-anchor", "end");
      label.textContent = y;
      labelsGroup.appendChild(label);
    }

    // Origin label
    const originLabel = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text",
    );
    originLabel.setAttribute("x", scaleX(0) - 8);
    originLabel.setAttribute("y", scaleY(0) + 16);
    originLabel.setAttribute("text-anchor", "end");
    originLabel.textContent = "O";
    originLabel.setAttribute("font-weight", "600");
    labelsGroup.appendChild(originLabel);

    // X label
    const xLabel = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text",
    );
    xLabel.setAttribute("x", width - padding + 5);
    xLabel.setAttribute("y", scaleY(0) + 16);
    xLabel.textContent = "x";
    xLabel.setAttribute("font-style", "italic");
    labelsGroup.appendChild(xLabel);

    // Y label
    const yLabel = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text",
    );
    yLabel.setAttribute("x", scaleX(0) + 10);
    yLabel.setAttribute("y", padding + 5);
    yLabel.textContent = "y";
    yLabel.setAttribute("font-style", "italic");
    labelsGroup.appendChild(yLabel);

    svg.appendChild(labelsGroup);
  }

  // Create a group for points and lines
  const contentGroup = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g",
  );
  contentGroup.setAttribute("class", "content");
  svg.appendChild(contentGroup);

  // Return object with methods to add points, lines, etc.
  return {
    svg,
    scaleX,
    scaleY,
    contentGroup,

    /**
     * Add a point to the graph
     */
    addPoint(x, y, options = {}) {
      const {
        color = "#6366f1",
        radius = 6,
        label = "",
        labelOffset = { x: 10, y: -10 },
      } = options;

      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("class", "point");

      // Point circle
      const circle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      circle.setAttribute("cx", scaleX(x));
      circle.setAttribute("cy", scaleY(y));
      circle.setAttribute("r", radius);
      circle.setAttribute("fill", color);
      group.appendChild(circle);

      // Label
      if (label) {
        const text = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "text",
        );
        text.setAttribute("x", scaleX(x) + labelOffset.x);
        text.setAttribute("y", scaleY(y) + labelOffset.y);
        text.setAttribute("font-family", "Inter, sans-serif");
        text.setAttribute("font-size", "14");
        text.setAttribute("font-weight", "600");
        text.setAttribute("fill", color);
        text.textContent = label;
        group.appendChild(text);
      }

      contentGroup.appendChild(group);
      return group;
    },

    /**
     * Add a line between two points
     */
    addLine(x1, y1, x2, y2, options = {}) {
      const { color = "#6366f1", width = 2, dashed = false } = options;

      const line = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      line.setAttribute("x1", scaleX(x1));
      line.setAttribute("y1", scaleY(y1));
      line.setAttribute("x2", scaleX(x2));
      line.setAttribute("y2", scaleY(y2));
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-width", width);
      if (dashed) {
        line.setAttribute("stroke-dasharray", "5,5");
      }

      contentGroup.appendChild(line);
      return line;
    },

    /**
     * Add a function graph (e.g., y = 2x + 1)
     */
    addFunction(fn, options = {}) {
      const { color = "#6366f1", width = 2, step = 0.1 } = options;

      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      let d = "";

      for (let x = xMin; x <= xMax; x += step) {
        const y = fn(x);
        if (y >= yMin && y <= yMax) {
          const px = scaleX(x);
          const py = scaleY(y);
          if (d === "") {
            d = `M ${px} ${py}`;
          } else {
            d += ` L ${px} ${py}`;
          }
        }
      }

      path.setAttribute("d", d);
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", width);
      path.setAttribute("fill", "none");

      contentGroup.appendChild(path);
      return path;
    },

    /**
     * Add a polyline (connected points)
     */
    addPolyline(points, options = {}) {
      const {
        color = "#c9a227",
        width = 3,
        showPoints = true,
        pointRadius = 5,
        dashed = false,
      } = options;

      if (!points || points.length < 2) return null;

      // Draw the line
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      let d = "";
      points.forEach((p, i) => {
        const px = scaleX(p[0] ?? p.x);
        const py = scaleY(p[1] ?? p.y);
        if (i === 0) {
          d = `M ${px} ${py}`;
        } else {
          d += ` L ${px} ${py}`;
        }
      });

      path.setAttribute("d", d);
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", width);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      if (dashed) {
        path.setAttribute("stroke-dasharray", "8,4");
      }
      contentGroup.appendChild(path);

      // Draw points on the line
      if (showPoints) {
        points.forEach((p) => {
          const circle = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "circle",
          );
          circle.setAttribute("cx", scaleX(p[0] ?? p.x));
          circle.setAttribute("cy", scaleY(p[1] ?? p.y));
          circle.setAttribute("r", pointRadius);
          circle.setAttribute("fill", color);
          contentGroup.appendChild(circle);
        });
      }

      return path;
    },

    /**
     * Add a curve (smooth connected points for global graphs)
     */
    addCurve(points, options = {}) {
      const { color = "#c9a227", width = 3 } = options;

      if (!points || points.length < 2) return null;

      // Use catmull-rom spline for smooth curves
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );

      let d = "";
      const pts = points.map((p) => ({
        x: scaleX(p.x ?? p[0]),
        y: scaleY(p.y ?? p[1]),
      }));

      // Simple smooth curve using quadratic beziers
      d = `M ${pts[0].x} ${pts[0].y}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i];
        const p1 = pts[i + 1];
        const midX = (p0.x + p1.x) / 2;
        const midY = (p0.y + p1.y) / 2;
        d += ` Q ${p0.x} ${p0.y} ${midX} ${midY}`;
      }
      d += ` T ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;

      path.setAttribute("d", d);
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", width);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");

      contentGroup.appendChild(path);
      return path;
    },

    /**
     * Clear all content (points, lines, functions)
     */
    clear() {
      contentGroup.innerHTML = "";
    },
  };
}

/**
 * Render a graph question with image
 */
export function renderGraphQuestion(container, config) {
  const {
    points = [],
    lines = [],
    functions = [],
    xMin = -6,
    xMax = 6,
    yMin = -6,
    yMax = 6,
  } = config;

  const graph = createCoordinateSystem({
    width: 350,
    height: 350,
    xMin,
    xMax,
    yMin,
    yMax,
  });

  // Add points
  points.forEach((p) => {
    graph.addPoint(p.x, p.y, {
      label: p.label || "",
      color: p.color || "#6366f1",
    });
  });

  // Add lines
  lines.forEach((l) => {
    graph.addLine(l.x1, l.y1, l.x2, l.y2, {
      color: l.color || "#6366f1",
      dashed: l.dashed || false,
    });
  });

  // Add functions
  functions.forEach((f) => {
    graph.addFunction(f.fn, {
      color: f.color || "#6366f1",
    });
  });

  container.appendChild(graph.svg);
  return graph;
}

/**
 * Create a line graph with custom axes (for time-series data)
 * Used for grid_graph type questions
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

  // Scale functions
  const scaleX = (x) =>
    padding.left + ((x - xMin) / (xMax - xMin)) * innerWidth;
  const scaleY = (y) =>
    padding.top + ((yMax - y) / (yMax - yMin)) * innerHeight;

  // Create SVG
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "line-graph");
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";

  // Background
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", width);
  bg.setAttribute("height", height);
  bg.setAttribute("fill", "#fafafa");
  bg.setAttribute("rx", "8");
  svg.appendChild(bg);

  // Grid
  if (showGrid) {
    const gridGroup = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "g",
    );
    gridGroup.setAttribute("stroke", "#e5e5e5");
    gridGroup.setAttribute("stroke-width", "1");

    // Vertical grid lines
    for (let x = xMin; x <= xMax; x += xStep) {
      const line = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      line.setAttribute("x1", scaleX(x));
      line.setAttribute("y1", padding.top);
      line.setAttribute("x2", scaleX(x));
      line.setAttribute("y2", height - padding.bottom);
      gridGroup.appendChild(line);
    }

    // Horizontal grid lines
    for (let y = yMin; y <= yMax; y += yStep) {
      const line = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      line.setAttribute("x1", padding.left);
      line.setAttribute("y1", scaleY(y));
      line.setAttribute("x2", width - padding.right);
      line.setAttribute("y2", scaleY(y));
      gridGroup.appendChild(line);
    }

    svg.appendChild(gridGroup);
  }

  // Axes
  const axesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  axesGroup.setAttribute("stroke", "#333");
  axesGroup.setAttribute("stroke-width", "2");

  // X-axis
  const xAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  xAxis.setAttribute("x1", padding.left);
  xAxis.setAttribute("y1", height - padding.bottom);
  xAxis.setAttribute("x2", width - padding.right);
  xAxis.setAttribute("y2", height - padding.bottom);
  axesGroup.appendChild(xAxis);

  // Y-axis
  const yAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  yAxis.setAttribute("x1", padding.left);
  yAxis.setAttribute("y1", padding.top);
  yAxis.setAttribute("x2", padding.left);
  yAxis.setAttribute("y2", height - padding.bottom);
  axesGroup.appendChild(yAxis);

  svg.appendChild(axesGroup);

  // Labels
  const labelsGroup = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g",
  );
  labelsGroup.setAttribute("font-family", "Inter, sans-serif");
  labelsGroup.setAttribute("font-size", "11");
  labelsGroup.setAttribute("fill", "#666");

  // X-axis tick labels
  for (let x = xMin; x <= xMax; x += xStep) {
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", scaleX(x));
    label.setAttribute("y", height - padding.bottom + 18);
    label.setAttribute("text-anchor", "middle");
    label.textContent = x;
    labelsGroup.appendChild(label);
  }

  // Y-axis tick labels
  for (let y = yMin; y <= yMax; y += yStep) {
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", padding.left - 8);
    label.setAttribute("y", scaleY(y) + 4);
    label.setAttribute("text-anchor", "end");
    label.textContent = y;
    labelsGroup.appendChild(label);
  }

  // Axis labels
  const xAxisLabel = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "text",
  );
  xAxisLabel.setAttribute("x", width / 2);
  xAxisLabel.setAttribute("y", height - 8);
  xAxisLabel.setAttribute("text-anchor", "middle");
  xAxisLabel.setAttribute("font-size", "13");
  xAxisLabel.setAttribute("fill", "#333");
  xAxisLabel.textContent = xLabel;
  labelsGroup.appendChild(xAxisLabel);

  const yAxisLabel = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "text",
  );
  yAxisLabel.setAttribute("x", 15);
  yAxisLabel.setAttribute("y", height / 2);
  yAxisLabel.setAttribute("text-anchor", "middle");
  yAxisLabel.setAttribute("font-size", "13");
  yAxisLabel.setAttribute("fill", "#333");
  yAxisLabel.setAttribute("transform", `rotate(-90, 15, ${height / 2})`);
  yAxisLabel.textContent = yLabel;
  labelsGroup.appendChild(yAxisLabel);

  svg.appendChild(labelsGroup);

  // Content group for data
  const contentGroup = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g",
  );
  contentGroup.setAttribute("class", "content");
  svg.appendChild(contentGroup);

  return {
    svg,
    scaleX,
    scaleY,
    contentGroup,

    addPolyline(points, options = {}) {
      const {
        color = "#c9a227",
        width = 3,
        showPoints = true,
        pointRadius = 5,
        label = "",
      } = options;

      if (!points || points.length < 2) return null;

      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      let d = "";
      points.forEach((p, i) => {
        const px = scaleX(p[0] ?? p.x);
        const py = scaleY(p[1] ?? p.y);
        if (i === 0) {
          d = `M ${px} ${py}`;
        } else {
          d += ` L ${px} ${py}`;
        }
      });

      path.setAttribute("d", d);
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", width);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      contentGroup.appendChild(path);

      if (showPoints) {
        points.forEach((p) => {
          const circle = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "circle",
          );
          circle.setAttribute("cx", scaleX(p[0] ?? p.x));
          circle.setAttribute("cy", scaleY(p[1] ?? p.y));
          circle.setAttribute("r", pointRadius);
          circle.setAttribute("fill", color);
          contentGroup.appendChild(circle);
        });
      }

      // Add label if provided (for multi-line graphs)
      if (label && points.length > 0) {
        const lastPt = points[points.length - 1];
        const text = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "text",
        );
        text.setAttribute("x", scaleX(lastPt[0] ?? lastPt.x) + 8);
        text.setAttribute("y", scaleY(lastPt[1] ?? lastPt.y) + 4);
        text.setAttribute("font-family", "Inter, sans-serif");
        text.setAttribute("font-size", "12");
        text.setAttribute("font-weight", "600");
        text.setAttribute("fill", color);
        text.textContent = label;
        contentGroup.appendChild(text);
      }

      return path;
    },
  };
}

/**
 * Create a global graph (sketch without exact scale)
 * Used for global_graph type questions
 */
export function createGlobalGraph(options = {}) {
  const {
    width = 350,
    height = 200,
    xLabel = "tijd",
    yLabel = "waarde",
  } = options;

  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  // Create SVG
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "global-graph");
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";

  // Background
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", width);
  bg.setAttribute("height", height);
  bg.setAttribute("fill", "#f8f9fa");
  bg.setAttribute("rx", "8");
  svg.appendChild(bg);

  // Axes
  const axesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  axesGroup.setAttribute("stroke", "#333");
  axesGroup.setAttribute("stroke-width", "2");

  // X-axis
  const xAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  xAxis.setAttribute("x1", padding.left);
  xAxis.setAttribute("y1", height - padding.bottom);
  xAxis.setAttribute("x2", width - padding.right);
  xAxis.setAttribute("y2", height - padding.bottom);
  axesGroup.appendChild(xAxis);

  // Y-axis
  const yAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  yAxis.setAttribute("x1", padding.left);
  yAxis.setAttribute("y1", padding.top);
  yAxis.setAttribute("x2", padding.left);
  yAxis.setAttribute("y2", height - padding.bottom);
  axesGroup.appendChild(yAxis);

  // Arrows
  const arrowSize = 8;
  const xArrow = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "polygon",
  );
  xArrow.setAttribute(
    "points",
    `${width - padding.right},${height - padding.bottom} ${width - padding.right - arrowSize},${height - padding.bottom - arrowSize / 2} ${width - padding.right - arrowSize},${height - padding.bottom + arrowSize / 2}`,
  );
  xArrow.setAttribute("fill", "#333");
  axesGroup.appendChild(xArrow);

  const yArrow = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "polygon",
  );
  yArrow.setAttribute(
    "points",
    `${padding.left},${padding.top} ${padding.left - arrowSize / 2},${padding.top + arrowSize} ${padding.left + arrowSize / 2},${padding.top + arrowSize}`,
  );
  yArrow.setAttribute("fill", "#333");
  axesGroup.appendChild(yArrow);

  svg.appendChild(axesGroup);

  // Axis labels
  const labelsGroup = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g",
  );
  labelsGroup.setAttribute("font-family", "Inter, sans-serif");
  labelsGroup.setAttribute("font-size", "13");
  labelsGroup.setAttribute("fill", "#333");

  const xLabelEl = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "text",
  );
  xLabelEl.setAttribute("x", width - padding.right + 5);
  xLabelEl.setAttribute("y", height - padding.bottom + 18);
  xLabelEl.textContent = xLabel;
  labelsGroup.appendChild(xLabelEl);

  const yLabelEl = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "text",
  );
  yLabelEl.setAttribute("x", padding.left + 5);
  yLabelEl.setAttribute("y", padding.top - 5);
  yLabelEl.textContent = yLabel;
  labelsGroup.appendChild(yLabelEl);

  svg.appendChild(labelsGroup);

  // Content group
  const contentGroup = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g",
  );
  contentGroup.setAttribute("class", "content");
  svg.appendChild(contentGroup);

  return {
    svg,
    contentGroup,
    innerWidth,
    innerHeight,
    padding,

    // Add smooth curve for global graph
    addCurve(points, options = {}) {
      const { color = "#c9a227", width = 3 } = options;

      if (!points || points.length < 2) return null;

      // Normalize points to fit in the graph area
      const xValues = points.map((p) => p.x ?? p[0]);
      const yValues = points.map((p) => p.y ?? p[1]);
      const minX = Math.min(...xValues);
      const maxX = Math.max(...xValues);
      const minY = Math.min(...yValues);
      const maxY = Math.max(...yValues);

      const scaleX = (x) =>
        padding.left + ((x - minX) / (maxX - minX)) * innerWidth;
      const scaleY = (y) =>
        padding.top + ((maxY - y) / (maxY - minY)) * innerHeight;

      // Create smooth path
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );

      const pts = points.map((p) => ({
        x: scaleX(p.x ?? p[0]),
        y: scaleY(p.y ?? p[1]),
      }));

      let d = `M ${pts[0].x} ${pts[0].y}`;

      // Use cardinal spline for smoothness
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

      path.setAttribute("d", d);
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", width);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");

      contentGroup.appendChild(path);
      return path;
    },
  };
}
