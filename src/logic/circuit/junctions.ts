// Wire junction (connection dot) detection: a dot is drawn only where 3+ collinear
// directions of the SAME net meet outside any component body.
import type { CircuitBounds, CircuitGraph } from "../../types";
import type { Point, Segment, WireSegment } from "./geometry";
import { normalizePoint, pointKey, pointsFromFlat, pointsToSegments } from "./geometry";
import { getNodeBounds } from "./pins";

function addDot(dots: Map<string, { x: number; y: number; count: number; netId?: string }>, point: Point, count = 1, netId?: string) {
  const key = pointKey(point);
  const existing = dots.get(key);
  dots.set(key, { x: Math.round(point.x), y: Math.round(point.y), netId: existing?.netId ?? netId, count: (existing?.count ?? 0) + count });
}

function pointIsInsideBounds(point: Point, bounds: CircuitBounds) {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  return point.x > bounds.x + 1 && point.x < right - 1 && point.y > bounds.y + 1 && point.y < bottom - 1;
}

function componentBodyBounds(graph: CircuitGraph) {
  return graph.nodes
    .filter((node) => node.type === "AND" || node.type === "OR" || node.type === "NOT" || node.type === "FF")
    .map((node) => ({ ...getNodeBounds(node), padding: 0 }));
}

function segmentIsHorizontal(segment: Segment) {
  return segment.from.y === segment.to.y;
}

function segmentIsVertical(segment: Segment) {
  return segment.from.x === segment.to.x;
}

function pointIsOnSegment(point: Point, segment: Segment) {
  const normalized = normalizePoint(point);
  if (segmentIsHorizontal(segment) && normalized.y === segment.from.y) {
    return normalized.x >= Math.min(segment.from.x, segment.to.x) && normalized.x <= Math.max(segment.from.x, segment.to.x);
  }
  if (segmentIsVertical(segment) && normalized.x === segment.from.x) {
    return normalized.y >= Math.min(segment.from.y, segment.to.y) && normalized.y <= Math.max(segment.from.y, segment.to.y);
  }
  return false;
}

function directionsAtPoint(point: Point, segment: Segment) {
  const normalized = normalizePoint(point);
  const directions: string[] = [];
  if (segmentIsHorizontal(segment)) {
    if (normalized.x > Math.min(segment.from.x, segment.to.x)) directions.push("left");
    if (normalized.x < Math.max(segment.from.x, segment.to.x)) directions.push("right");
  } else if (segmentIsVertical(segment)) {
    if (normalized.y > Math.min(segment.from.y, segment.to.y)) directions.push("up");
    if (normalized.y < Math.max(segment.from.y, segment.to.y)) directions.push("down");
  }
  return directions;
}

function addCandidate(candidates: Map<string, { netId: string; point: Point }>, netId: string, point: Point) {
  if (!netId) return;
  const normalized = normalizePoint(point);
  candidates.set(`${netId}:${pointKey(normalized)}`, { netId, point: normalized });
}

function segmentIntersectionPoints(segment: Segment, other: Segment) {
  const points: Point[] = [];
  if (segmentIsHorizontal(segment) && segmentIsVertical(other)) {
    const point = { x: other.from.x, y: segment.from.y };
    if (pointIsOnSegment(point, segment) && pointIsOnSegment(point, other)) points.push(point);
  } else if (segmentIsVertical(segment) && segmentIsHorizontal(other)) {
    const point = { x: segment.from.x, y: other.from.y };
    if (pointIsOnSegment(point, segment) && pointIsOnSegment(point, other)) points.push(point);
  } else if (segmentIsHorizontal(segment) && segmentIsHorizontal(other) && segment.from.y === other.from.y) {
    const start = Math.max(Math.min(segment.from.x, segment.to.x), Math.min(other.from.x, other.to.x));
    const end = Math.min(Math.max(segment.from.x, segment.to.x), Math.max(other.from.x, other.to.x));
    if (start <= end) {
      points.push({ x: start, y: segment.from.y });
      if (end !== start) points.push({ x: end, y: segment.from.y });
    }
  } else if (segmentIsVertical(segment) && segmentIsVertical(other) && segment.from.x === other.from.x) {
    const start = Math.max(Math.min(segment.from.y, segment.to.y), Math.min(other.from.y, other.to.y));
    const end = Math.min(Math.max(segment.from.y, segment.to.y), Math.max(other.from.y, other.to.y));
    if (start <= end) {
      points.push({ x: segment.from.x, y: start });
      if (end !== start) points.push({ x: segment.from.x, y: end });
    }
  }
  return points;
}

export function collectWireSegments(graph: CircuitGraph): WireSegment[] {
  return graph.edges.flatMap((edge) =>
    pointsToSegments(pointsFromFlat(edge.points)).map((segment) => ({
      ...segment,
      edgeId: edge.id,
      wireId: edge.wireId ?? edge.id ?? `${edge.from}->${edge.to}`,
      netId: edge.netId ?? "",
    })),
  );
}

export function detectJunctions(segments: WireSegment[], bodyBounds: CircuitBounds[] = []) {
  const segmentsByNet = new Map<string, WireSegment[]>();
  const candidates = new Map<string, { netId: string; point: Point }>();
  const dots = new Map<string, { x: number; y: number; count: number; netId?: string }>();

  for (const segment of segments) {
    if (!segment.netId) continue;
    const list = segmentsByNet.get(segment.netId) ?? [];
    list.push(segment);
    segmentsByNet.set(segment.netId, list);
    addCandidate(candidates, segment.netId, segment.from);
    addCandidate(candidates, segment.netId, segment.to);
  }

  for (const [netId, netSegments] of segmentsByNet) {
    for (let index = 0; index < netSegments.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < netSegments.length; otherIndex += 1) {
        for (const point of segmentIntersectionPoints(netSegments[index], netSegments[otherIndex])) {
          addCandidate(candidates, netId, point);
        }
      }
    }
  }

  for (const candidate of candidates.values()) {
    const netSegments = segmentsByNet.get(candidate.netId) ?? [];
    const touchingSegments = netSegments.filter((segment) => pointIsOnSegment(candidate.point, segment));
    if (!touchingSegments.length) continue;

    const directions = new Set<string>();
    for (const segment of touchingSegments) {
      directionsAtPoint(candidate.point, segment).forEach((direction) => directions.add(direction));
    }

    if (directions.size < 3) continue;
    if (bodyBounds.some((bounds) => pointIsInsideBounds(candidate.point, bounds))) continue;
    addDot(dots, candidate.point, touchingSegments.length, candidate.netId);
  }

  return [...dots.values()];
}

export function collectWireJunctionDots(graph: CircuitGraph) {
  const bodyBounds = componentBodyBounds(graph);
  const segments = collectWireSegments(graph);
  return detectJunctions(segments, bodyBounds);
}
