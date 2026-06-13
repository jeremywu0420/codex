// SVG serialization of a laid-out circuit graph (used for export and as the
// authoritative render the Konva canvas mirrors) plus content-bounds measurement.
import type { CircuitBounds, CircuitGraph, CircuitNode } from "../../types";
import type { Point } from "./geometry";
import { expandBounds, pointsFromFlat } from "./geometry";
import { ffHeight, ffWidth } from "./constants";
import { getNodeBounds } from "./pins";
import { collectWireJunctionDots } from "./junctions";

const svgWireColor = "#1e293b";
const svgClockColor = "#2563eb";

function svgPoints(points: number[]) {
  const pairs: string[] = [];
  for (let index = 0; index < points.length; index += 2) pairs.push(`${points[index]},${points[index + 1]}`);
  return pairs.join(" ");
}

export function getCircuitContentBounds(graph: CircuitGraph, padding = 28): CircuitBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const includePoint = (point: Point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };
  const includeBounds = (bounds: CircuitBounds) => {
    includePoint({ x: bounds.x, y: bounds.y });
    includePoint({ x: bounds.x + bounds.width, y: bounds.y + bounds.height });
  };

  for (const node of graph.nodes) {
    includeBounds(getNodeBounds(node));
    if (node.type === "FF") {
      includeBounds({
        id: `${node.id}:labels`,
        x: node.x,
        y: node.y,
        width: node.width ?? ffWidth,
        height: (node.height ?? ffHeight) + 24,
      });
    }
  }

  for (const edge of graph.edges) {
    for (const point of pointsFromFlat(edge.points)) includePoint(point);
  }
  for (const point of pointsFromFlat(graph.clockLine.points)) includePoint(point);
  for (const branch of graph.clockLine.branches) {
    for (const point of pointsFromFlat(branch)) includePoint(point);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { id: "content", x: 0, y: 0, width: 1, height: 1 };
  }

  const x = Math.max(0, Math.floor(minX - padding));
  const y = Math.max(0, Math.floor(minY - padding));
  const right = Math.ceil(maxX + padding);
  const bottom = Math.ceil(maxY + padding);
  return {
    id: "content",
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function svgFormulaText(x: number, y: number, label: string, size = 13) {
  const [main, sub] = label.split("_");
  const mainText = `<text x="${x}" y="${y + size}" font-family="Times New Roman" font-size="${size}" font-style="italic" font-weight="700" fill="#334155">${escapeXml(main)}</text>`;
  if (!sub) return mainText;
  return `${mainText}<text x="${x + size * 0.62}" y="${y + size * 1.17}" font-family="Times New Roman" font-size="${size * 0.62}" font-style="italic" font-weight="700" fill="#334155">${escapeXml(sub)}</text>`;
}

function svgGateBody(node: CircuitNode) {
  if (node.type === "AND") {
    return `<path d="M${node.x} ${node.y} L${node.x + 44} ${node.y} A22 22 0 0 1 ${node.x + 44} ${node.y + 44} L${node.x} ${node.y + 44} Z" stroke="${svgWireColor}" stroke-width="1.8" stroke-linejoin="round" fill="white"/>`;
  }
  if (node.type === "OR") {
    return `<path d="M${node.x} ${node.y} Q${node.x + 48} ${node.y + 2} ${node.x + 86} ${node.y + 30} Q${node.x + 48} ${node.y + 58} ${node.x} ${node.y + 60} Q${node.x + 19} ${node.y + 30} ${node.x} ${node.y} Z" stroke="${svgWireColor}" stroke-width="1.8" stroke-linejoin="round" fill="white"/>`;
  }
  if (node.type === "NOT") {
    return `<path d="M${node.x} ${node.y} L${node.x + 30} ${node.y + 15} L${node.x} ${node.y + 30} Z" stroke="${svgWireColor}" stroke-width="1.6" stroke-linejoin="round" fill="white"/><circle cx="${node.x + 35}" cy="${node.y + 15}" r="5" stroke="${svgWireColor}" stroke-width="1.6" fill="white"/>`;
  }
  return "";
}

function svgFlipFlopBody(node: CircuitNode) {
  return `<rect x="${node.x}" y="${node.y}" width="${node.width ?? ffWidth}" height="${node.height ?? ffHeight}" rx="6" fill="white" stroke="${svgWireColor}" stroke-width="1.8"/><polyline points="${node.x + 50},${node.y + 124} ${node.x + 63},${node.y + 112} ${node.x + 76},${node.y + 124}" fill="none" stroke="${svgClockColor}" stroke-width="1.7" stroke-linejoin="round"/>`;
}

function flipFlopPinOffset(pin: string) {
  if (pin === "K" || pin === "R") return 86;
  if (pin === "D" || pin === "T") return 63;
  return 42;
}

function svgNodeLabels(node: CircuitNode) {
  if (node.type === "FF") {
    const type = node.flipFlopType ?? "jk";
    const pins = type === "jk" ? ["J", "K"] : type === "sr" ? ["S", "R"] : [type.toUpperCase()];
    const state = String(node.metadata?.state ?? node.label);
    const pinLabels = pins
      .map((pin) => svgFormulaText(node.x + 14, node.y + flipFlopPinOffset(pin) - 13, `${pin}_${state}`, 16))
      .join("");
    return [
      pinLabels,
      svgFormulaText(node.x + 90, node.y + 34, `Q_${state}`, 16),
      svgFormulaText(node.x + 86, node.y + 82, `Q'_${state}`, 16),
      `<text x="${node.x + 48}" y="${node.y + 143}" font-size="12" font-weight="700" fill="${svgClockColor}">CLK</text>`,
    ].join("");
  }
  if (node.type === "AND" || node.type === "OR" || node.type === "NOT" || node.type === "STATE" || node.type === "STATE_NOT") return "";
  const labelX = typeof node.metadata?.labelX === "number" ? node.metadata.labelX : node.x + 8;
  const labelY = typeof node.metadata?.labelY === "number" ? node.metadata.labelY : node.y - 11;
  return svgFormulaText(labelX, labelY, node.label, 13);
}

function svgRoutingBounds(bounds: CircuitBounds[]) {
  return bounds
    .map((bounds) => {
      const expanded = expandBounds(bounds, bounds.padding ?? 0);
      return `<rect x="${expanded.x}" y="${expanded.y}" width="${expanded.width}" height="${expanded.height}" fill="none" stroke="#38bdf8" stroke-width="1" stroke-dasharray="5 4" opacity="0.38"/>`;
    })
    .join("");
}

function svgClockLabels(graph: CircuitGraph) {
  if (!graph.clockLine.points.length) return "";
  const [startX, startY, endX, endY] = graph.clockLine.points;
  return [
    `<text x="${startX + 8}" y="${startY + 24}" font-family="Times New Roman" font-size="16" font-style="italic" font-weight="700" fill="${svgClockColor}">${escapeXml(graph.clockLine.label)}</text>`,
    `<text x="${endX + 8}" y="${endY + 6}" font-family="Times New Roman" font-size="16" font-style="italic" font-weight="700" fill="${svgClockColor}">${escapeXml(graph.clockLine.label)}</text>`,
  ].join("");
}

export function circuitGraphToSvg(graph: CircuitGraph, showRoutingBounds = false) {
  const contentBounds = getCircuitContentBounds(graph);
  const wires = graph.edges
    .filter((edge) => edge.points?.length)
    .map((edge) => `<polyline data-wire-id="${escapeXml(edge.wireId ?? edge.id ?? "")}" points="${svgPoints(edge.points!)}" fill="none" stroke="${svgWireColor}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`)
    .join("");
  const clock = [
    graph.clockLine.points.length ? `<polyline points="${svgPoints(graph.clockLine.points)}" fill="none" stroke="${svgClockColor}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>` : "",
    ...graph.clockLine.branches.map(
      (branch) =>
        `<polyline points="${svgPoints(branch)}" fill="none" stroke="${svgClockColor}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>`,
    ),
  ].join("");
  const gateBodies = graph.nodes.map(svgGateBody).join("");
  const flipFlopBodies = graph.nodes.filter((node) => node.type === "FF").map(svgFlipFlopBody).join("");
  const debugBounds = showRoutingBounds ? svgRoutingBounds(graph.metadata.routingBounds ?? []) : "";
  const labels = [
    svgClockLabels(graph),
    ...graph.nodes.map(svgNodeLabels),
  ].join("");
  const junctionDots = [
    ...graph.clockLine.branches.map((branch) => `<circle class="junction-dot" cx="${branch[0]}" cy="${branch[1]}" r="3.2" fill="${svgClockColor}"/>`),
    ...collectWireJunctionDots(graph).map((point) => `<circle class="junction-dot" cx="${point.x}" cy="${point.y}" r="3.2" fill="${svgWireColor}"/>`),
  ].join("");
  const gridDefs =
    `<defs><pattern id="circuit-grid" width="20" height="20" patternUnits="userSpaceOnUse">` +
    `<rect width="20" height="20" fill="white"/>` +
    `<circle cx="10" cy="10" r="0.9" fill="rgba(100, 116, 139, 0.30)"/>` +
    `</pattern></defs>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${contentBounds.width}" height="${contentBounds.height}" viewBox="${contentBounds.x} ${contentBounds.y} ${contentBounds.width} ${contentBounds.height}" style="overflow:visible">${gridDefs}<rect x="${contentBounds.x}" y="${contentBounds.y}" width="${contentBounds.width}" height="${contentBounds.height}" fill="url(#circuit-grid)"/>${wires}${clock}${gateBodies}${flipFlopBodies}${debugBounds}${junctionDots}${labels}</svg>`;
}
