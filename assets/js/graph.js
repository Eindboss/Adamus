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
