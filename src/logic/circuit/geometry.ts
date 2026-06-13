// Pure geometry helpers: points, orthogonal segments, bounds and overlap tests.
// Depends only on the shared circuit types.
import type { CircuitBounds, CircuitPoint } from "../../types";

export type Point = CircuitPoint;
export type Segment = { from: Point; to: Point; signalId?: string };
export type WireSegment = Segment & { edgeId?: string; netId: string; wireId: string };

export function expandBounds(bounds: CircuitBounds, padding: number): CircuitBounds {
  return {
    ...bounds,
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
    padding,
  };
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.max(aStart, bStart) <= Math.min(aEnd, bEnd);
}

export function segmentIntersectsBounds(segment: Segment, bounds: CircuitBounds) {
  const minX = Math.min(segment.from.x, segment.to.x);
  const maxX = Math.max(segment.from.x, segment.to.x);
  const minY = Math.min(segment.from.y, segment.to.y);
  const maxY = Math.max(segment.from.y, segment.to.y);
  const boundsRight = bounds.x + bounds.width;
  const boundsBottom = bounds.y + bounds.height;

  if (segment.from.y === segment.to.y) {
    return segment.from.y >= bounds.y && segment.from.y <= boundsBottom && rangesOverlap(minX, maxX, bounds.x, boundsRight);
  }
  if (segment.from.x === segment.to.x) {
    return segment.from.x >= bounds.x && segment.from.x <= boundsRight && rangesOverlap(minY, maxY, bounds.y, boundsBottom);
  }
  return false;
}

export function pathIntersectsObstacles(points: Point[], obstacles: CircuitBounds[]) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const segment = { from: points[index], to: points[index + 1] };
    if (obstacles.some((bounds) => segmentIntersectsBounds(segment, bounds))) return true;
  }
  return false;
}

export function pointsToSegments(points: Point[]): Segment[] {
  const segments: Segment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from.x === to.x && from.y === to.y) continue;
    segments.push({ from, to });
  }
  return segments;
}

function overlapLength(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  const aMin = Math.min(aStart, aEnd);
  const aMax = Math.max(aStart, aEnd);
  const bMin = Math.min(bStart, bEnd);
  const bMax = Math.max(bStart, bEnd);
  return Math.min(aMax, bMax) - Math.max(aMin, bMin);
}

export function segmentsOverlap(segment: Segment, other: Segment) {
  const segmentIsHorizontal = segment.from.y === segment.to.y;
  const otherIsHorizontal = other.from.y === other.to.y;
  const segmentIsVertical = segment.from.x === segment.to.x;
  const otherIsVertical = other.from.x === other.to.x;

  if (segmentIsHorizontal && otherIsHorizontal && segment.from.y === other.from.y) {
    return overlapLength(segment.from.x, segment.to.x, other.from.x, other.to.x) > 1;
  }
  if (segmentIsVertical && otherIsVertical && segment.from.x === other.from.x) {
    return overlapLength(segment.from.y, segment.to.y, other.from.y, other.to.y) > 1;
  }
  return false;
}

export function pathOverlapsSegments(points: Point[], usedSegments: Segment[], signalId?: string) {
  if (!usedSegments.length) return false;
  return pointsToSegments(points).some((segment) =>
    usedSegments.some((usedSegment) => usedSegment.signalId !== signalId && segmentsOverlap(segment, usedSegment)),
  );
}

export function flattenPoints(points: Point[]) {
  return points.flatMap((point) => [Math.round(point.x), Math.round(point.y)]);
}

export function compactPoints(points: Point[]) {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    if (!previous) return true;
    return previous.x !== point.x || previous.y !== point.y;
  });
}

export function pointsFromFlat(points?: number[]) {
  const result: Point[] = [];
  if (!points) return result;
  for (let index = 0; index < points.length; index += 2) result.push({ x: points[index], y: points[index + 1] });
  return result;
}

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function flatPointAt(points: number[], index: number): Point | null {
  const pointIndex = index < 0 ? points.length + index * 2 : index * 2;
  if (pointIndex < 0 || pointIndex + 1 >= points.length) return null;
  return { x: points[pointIndex], y: points[pointIndex + 1] };
}

export function pointKey(point: Point) {
  return `${Math.round(point.x)},${Math.round(point.y)}`;
}

export function normalizePoint(point: Point) {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}
