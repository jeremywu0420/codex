import type { CircuitBounds, CircuitEdge, CircuitGraph, CircuitNode, CircuitPoint } from "../types";

const ffWidth = 126;
const ffHeight = 124;
const obstaclePadding = 12;
const routingChannelY = 34;
const routingChannelX = 20;
const channelStep = 24;
const feedbackLaneStep = 24;
const zone = {
  inputX: 56,
  inputNotX: 132,
  busStartX: 230,
  busTrackStep: 30,
  productX: 470,
  sumX: 650,
  outputX: 824,
  ffX: 880,
  feedbackBusX: 1062,
  gateToGateLaneX: 608,
  ffApproachX: 812,
};
const layoutTop = 220;
const targetSlotSpacing = 118;
const srTargetSlotSpacing = 148;
const productTermSpacing = 96;
const srProductTermSpacing = 116;
const feedbackTopY = 48;
const clockGap = 88;

type Point = CircuitPoint;
type Segment = { from: Point; to: Point; signalId?: string };
export type WireSegment = Segment & { edgeId?: string; netId: string; wireId: string };
type NodePins = {
  inputPins: Point[];
  outputPin?: Point;
  pins: Record<string, Point>;
};

function cloneGraph(graph: CircuitGraph): CircuitGraph {
  return {
    nodes: graph.nodes.map((node) => ({ ...node, metadata: { ...node.metadata } })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      metadata: { ...edge.metadata },
      points: edge.points ? [...edge.points] : undefined,
      sourceAnchor: edge.sourceAnchor ? { ...edge.sourceAnchor } : undefined,
      targetAnchor: edge.targetAnchor ? { ...edge.targetAnchor } : undefined,
    })),
    clockLine: { ...graph.clockLine, points: [...graph.clockLine.points], branches: graph.clockLine.branches.map((branch) => [...branch]) },
    metadata: { ...graph.metadata, routingBounds: graph.metadata.routingBounds ? [...graph.metadata.routingBounds] : undefined },
  };
}

function splitTarget(edge: CircuitEdge) {
  const targetState = edge.metadata?.targetState;
  const targetPin = edge.toPin ?? edge.metadata?.targetPin;
  const targetOutput = edge.metadata?.targetOutput;
  if (typeof targetState === "string" && typeof targetPin === "string") return { kind: "ff" as const, state: targetState, pin: targetPin };
  if (typeof targetOutput === "string") return { kind: "output" as const, output: targetOutput };
  return null;
}

function pinOffset(pin?: string) {
  if (pin === "K" || pin === "R") return 86;
  if (pin === "D" || pin === "T") return 63;
  return 42;
}

function gateInputY(node: CircuitNode, inputIndex: number, inputCount: number) {
  const height = node.height ?? 0;
  if (node.type === "NOT") return node.y + height / 2;
  if (inputCount <= 1) return node.y + height / 2;
  if (inputCount === 2) return node.y + height * (inputIndex === 0 ? 0.35 : 0.65);
  const lane = (inputIndex + 1) / (inputCount + 1);
  return node.y + height * (0.2 + lane * 0.6);
}

export function getNodePins(node: CircuitNode, inputCount = 2): NodePins {
  const width = node.width ?? gateSize(node.type).width;
  const height = node.height ?? gateSize(node.type).height;
  if (node.type === "FF") {
    const inputX = node.x + 2;
    const outputX = node.x + ffWidth;
    return {
      inputPins: [
        { x: inputX, y: node.y + 42 },
        { x: inputX, y: node.y + 86 },
      ],
      outputPin: { x: outputX, y: node.y + 42 },
      pins: {
        J: { x: inputX, y: node.y + 42 },
        K: { x: inputX, y: node.y + 86 },
        S: { x: inputX, y: node.y + 42 },
        R: { x: inputX, y: node.y + 86 },
        D: { x: inputX, y: node.y + 63 },
        T: { x: inputX, y: node.y + 63 },
        Q: { x: outputX, y: node.y + 42 },
        "Q'": { x: outputX, y: node.y + 90 },
        Qbar: { x: outputX, y: node.y + 90 },
        CLK: { x: node.x + ffWidth / 2, y: node.y + ffHeight },
      },
    };
  }
  if (node.type === "AND" || node.type === "OR") {
    const inputX = node.x + 2;
    const inputPins = Array.from({ length: Math.max(1, inputCount) }, (_, index) => ({
      x: inputX,
      y: gateInputY(node, index, Math.max(1, inputCount)),
    }));
    const outputPin = { x: node.x + width, y: node.y + height / 2 };
    return { inputPins, outputPin, pins: { output: outputPin, out: outputPin } };
  }
  if (node.type === "NOT") {
    const inputPin = { x: node.x + 2, y: node.y + height / 2 };
    const outputPin = { x: node.x + width, y: node.y + height / 2 };
    return { inputPins: [inputPin], outputPin, pins: { input: inputPin, output: outputPin, out: outputPin } };
  }
  const anchor = { x: node.x, y: node.y };
  return { inputPins: [anchor], outputPin: anchor, pins: { input: anchor, output: anchor, out: anchor } };
}

function outputAnchor(node: CircuitNode, fromPin?: string) {
  const pins = getNodePins(node);
  if (fromPin && pins.pins[fromPin]) return pins.pins[fromPin];
  return pins.outputPin ?? pins.pins.output;
}

function inputAnchor(node: CircuitNode, toPin?: string, inputIndex = 0, inputCount = 1) {
  const pins = getNodePins(node, inputCount);
  if (toPin && pins.pins[toPin]) return pins.pins[toPin];
  if (node.type === "OUTPUT") return pins.pins.input;
  return pins.inputPins[Math.min(inputIndex, pins.inputPins.length - 1)] ?? pins.pins.input;
}

function routeOrthogonal(from: Point, to: Point, bendX?: number) {
  const midX = bendX ?? Math.round((from.x + to.x) / 2);
  return compactPoints([from, { x: midX, y: from.y }, { x: midX, y: to.y }, to]);
}

function gateSize(type: CircuitNode["type"]) {
  if (type === "OR") return { width: 86, height: 60 };
  if (type === "AND") return { width: 66, height: 44 };
  if (type === "NOT") return { width: 40, height: 30 };
  if (type === "FF") return { width: ffWidth, height: ffHeight };
  return { width: 1, height: 1 };
}

function labelBounds(node: CircuitNode): CircuitBounds {
  const width = Math.max(12, node.label.length * 8);
  const explicitLabelX = typeof node.metadata?.labelX === "number" ? node.metadata.labelX : undefined;
  const explicitLabelY = typeof node.metadata?.labelY === "number" ? node.metadata.labelY : undefined;
  const x = explicitLabelX ?? node.x + 8;
  const y = explicitLabelY ?? node.y - 11;
  return { id: node.id, x, y, width, height: 14, padding: 0 };
}

export function getNodeBounds(node: CircuitNode): CircuitBounds {
  if (node.type === "AND" || node.type === "OR" || node.type === "NOT" || node.type === "FF") {
    return {
      id: node.id,
      x: node.x,
      y: node.y,
      width: node.width ?? gateSize(node.type).width,
      height: node.height ?? gateSize(node.type).height,
      padding: obstaclePadding,
    };
  }
  if (node.type === "STATE" || node.type === "STATE_NOT") {
    return { id: node.id, x: node.x, y: node.y, width: 1, height: 1, padding: 0 };
  }
  return labelBounds(node);
}

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

function createRouteCandidateSelector(obstacles: CircuitBounds[], usedSegments: Segment[], signalId: string) {
  let firstObstacleClearPath: Point[] | null = null;
  return {
    isPreferred(points: Point[]) {
      if (pathIntersectsObstacles(points, obstacles)) return false;
      firstObstacleClearPath ??= points;
      return !pathOverlapsSegments(points, usedSegments, signalId);
    },
    fallback() {
      return firstObstacleClearPath;
    },
  };
}

function flattenPoints(points: Point[]) {
  return points.flatMap((point) => [Math.round(point.x), Math.round(point.y)]);
}

function compactPoints(points: Point[]) {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    if (!previous) return true;
    return previous.x !== point.x || previous.y !== point.y;
  });
}

function obstacleChannelCandidates(from: Point, to: Point, obstacles: CircuitBounds[]) {
  const baseY = Math.round((from.y + to.y) / 2);
  const obstacleCandidates = new Set<number>();
  const localCandidates = new Set<number>([96, 128, 360, 384, from.y, to.y, baseY, baseY - channelStep, baseY + channelStep]);
  for (let offset = channelStep; offset <= channelStep * 7; offset += channelStep) {
    localCandidates.add(from.y - offset);
    localCandidates.add(from.y + offset);
    localCandidates.add(to.y - offset);
    localCandidates.add(to.y + offset);
  }
  for (const obstacle of obstacles) {
    obstacleCandidates.add(obstacle.y - routingChannelY);
    obstacleCandidates.add(obstacle.y + obstacle.height + routingChannelY);
  }
  const byDistance = (a: number, b: number) => Math.abs(a - baseY) - Math.abs(b - baseY);
  const channels = [
    ...[...obstacleCandidates].filter((y) => y >= 24).sort(byDistance),
    ...[...localCandidates].filter((y) => y >= 24).sort(byDistance),
  ];
  return [...new Set(channels)]
    .filter((y) => y >= 24)
    .sort((a, b) => {
      const aIsObstacle = obstacleCandidates.has(a);
      const bIsObstacle = obstacleCandidates.has(b);
      if (aIsObstacle !== bIsObstacle) return aIsObstacle ? -1 : 1;
      return byDistance(a, b);
    });
}

function obstacleBendXCandidates(from: Point, to: Point, obstacles: CircuitBounds[]) {
  const baseX = Math.round((from.x + to.x) / 2);
  const candidates = new Set<number>([baseX, baseX - channelStep, baseX + channelStep]);
  for (const obstacle of obstacles) {
    candidates.add(obstacle.x - routingChannelX);
    candidates.add(obstacle.x + obstacle.width + routingChannelX);
  }
  return [...candidates].sort((a, b) => Math.abs(a - baseX) - Math.abs(b - baseX));
}

function pathWithChannel(from: Point, to: Point, fromNode: CircuitNode, toNode: CircuitNode, channelY: number, approachOffset = routingChannelX) {
  const isFeedback = from.x >= to.x;
  const sourceNeedsExit = isFeedback || fromNode.type === "AND" || fromNode.type === "OR" || fromNode.type === "NOT" || fromNode.type === "FF";
  const targetNeedsApproach = toNode.type === "AND" || toNode.type === "OR" || toNode.type === "NOT" || toNode.type === "FF";
  const sourceExitOffset = fromNode.type === "STATE" || fromNode.type === "STATE_NOT" ? 88 : routingChannelX;
  const exitX = from.x + (sourceNeedsExit ? sourceExitOffset : 0);
  const approachX = to.x - (targetNeedsApproach ? approachOffset : 0);
  return compactPoints([
    from,
    { x: exitX, y: from.y },
    { x: exitX, y: channelY },
    { x: approachX, y: channelY },
    { x: approachX, y: to.y },
    to,
  ]);
}

function feedbackLaneY(node: CircuitNode) {
  if (typeof node.metadata?.feedbackLaneY === "number") return node.metadata.feedbackLaneY;
  const lane = Number(node.metadata?.feedbackLane ?? 0);
  return node.type === "STATE_NOT" ? 384 + lane * feedbackLaneStep : 96 + lane * feedbackLaneStep;
}

function sanitizeWireId(value: string) {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function makeWireId(edge: CircuitEdge) {
  const fromPin = edge.fromPin ?? "out";
  const toPin = edge.toPin ?? (typeof edge.metadata?.gateInputIndex === "number" ? `in${edge.metadata.gateInputIndex}` : "in");
  return sanitizeWireId(`${edge.netId ?? "NET"}_${edge.from}_${fromPin}_to_${edge.to}_${toPin}`);
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function flatPointAt(points: number[], index: number): Point | null {
  const pointIndex = index < 0 ? points.length + index * 2 : index * 2;
  if (pointIndex < 0 || pointIndex + 1 >= points.length) return null;
  return { x: points[pointIndex], y: points[pointIndex + 1] };
}

function validateWire(edge: CircuitEdge) {
  if (!edge.points?.length || !edge.sourceAnchor || !edge.targetAnchor) return;
  const start = flatPointAt(edge.points, 0);
  const end = flatPointAt(edge.points, edge.points.length / 2 - 1);
  if (!start || !end) return;
  if (distance(start, edge.sourceAnchor) >= 1 || distance(end, edge.targetAnchor) >= 1) {
    console.warn("Circuit wire is not connected to pin anchors", {
      wireId: edge.wireId ?? edge.id,
      edgeId: edge.id,
      sourceDistance: distance(start, edge.sourceAnchor),
      targetDistance: distance(end, edge.targetAnchor),
      sourceAnchor: edge.sourceAnchor,
      targetAnchor: edge.targetAnchor,
      points: edge.points,
    });
  }
}

function resolveEdgeAnchors(edge: CircuitEdge, nodeById: Map<string, CircuitNode>) {
  const fromNode = nodeById.get(edge.from);
  const toNode = nodeById.get(edge.to);
  if (!fromNode || !toNode) return null;
  const inputIndex = Number(edge.metadata?.gateInputIndex ?? 0);
  const inputCount = Number(edge.metadata?.gateInputCount ?? 1);
  return {
    fromNode,
    toNode,
    sourceAnchor: outputAnchor(fromNode, edge.fromPin),
    targetAnchor: inputAnchor(toNode, edge.toPin, inputIndex, inputCount),
  };
}

function metadataNumber(node: CircuitNode, key: string) {
  const value = node.metadata?.[key];
  return typeof value === "number" ? value : undefined;
}

function isGate(node?: CircuitNode) {
  return node?.type === "AND" || node?.type === "OR" || node?.type === "NOT";
}

function busRoute(from: Point, to: Point, busX: number) {
  return compactPoints([from, { x: busX, y: from.y }, { x: busX, y: to.y }, to]);
}

function laneRoute(from: Point, to: Point, laneX: number) {
  return compactPoints([from, { x: laneX, y: from.y }, { x: laneX, y: to.y }, to]);
}

function gateOutputExit(from: Point, distance = routingChannelX) {
  return { x: from.x + distance, y: from.y };
}

function gateOutputLaneRoute(from: Point, to: Point, laneX: number) {
  const exit = gateOutputExit(from);
  const safeLaneX = Math.max(laneX, exit.x);
  return compactPoints([from, exit, { x: safeLaneX, y: from.y }, { x: safeLaneX, y: to.y }, to]);
}

function edgeInputIndex(edge: CircuitEdge) {
  return Number(edge.metadata?.gateInputIndex ?? 0);
}

function ffInputLane(edge: CircuitEdge, from: Point, to: Point) {
  const pin = edge.toPin ?? String(edge.metadata?.targetPin ?? "");
  const pinSlot = pin === "K" || pin === "R" ? 2 : pin === "D" || pin === "T" ? 1 : 0;
  const stateName = String(edge.metadata?.targetState ?? "");
  const stateIndex = stateName ? Math.max(0, stateName.toUpperCase().charCodeAt(0) - 65) : 0;
  const equationRank = Math.abs([...String(edge.netId ?? edge.id ?? "")].reduce((sum, character) => sum + character.charCodeAt(0), 0)) % 5;
  const baseLaneX = pinSlot === 2 ? zone.ffApproachX + 44 : pinSlot === 1 ? zone.ffApproachX + 24 : zone.ffApproachX + 8;
  const stateOffset = pinSlot === 2 ? -stateIndex * 12 : stateIndex * 8;
  const laneX = Math.max(zone.ffApproachX + 8, Math.min(zone.ffX - 24, baseLaneX + stateOffset));
  const laneY = Math.min(from.y, to.y) - 26 - equationRank * 12;
  return { laneX, laneY };
}

function routeDirectSignalToOr(from: Point, to: Point, busX: number, toNode: CircuitNode, inputIndex: number, exitX = busX) {
  const approachX = Math.min(to.x - 28, zone.productX + 136 + inputIndex * 8);
  const safeY = toNode.y - 34 - inputIndex * 14;
  return compactPoints([
    from,
    { x: exitX, y: from.y },
    { x: exitX, y: safeY },
    { x: busX, y: safeY },
    { x: approachX, y: safeY },
    { x: approachX, y: to.y },
    to,
  ]);
}

function deterministicRouteEdge(edge: CircuitEdge, nodes: CircuitNode[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const resolved = resolveEdgeAnchors(edge, nodeById);
  if (!resolved) return [];
  const { fromNode, toNode, sourceAnchor: from, targetAnchor: to } = resolved;
  const edgeNetId = edge.netId ?? "";
  const laneIndex = [...edgeNetId].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 9;
  const finalNetLaneX = 784 + laneIndex * 8;
  const stateSourceNet = fromNode.type === "STATE"
    ? nodeLabelNet(fromNode.label)
    : fromNode.type === "STATE_NOT"
      ? nodeLabelNet(fromNode.label)
      : "";

  if (fromNode.type === "FF" && (toNode.type === "STATE" || toNode.type === "STATE_NOT")) {
    return compactPoints([from, to]);
  }

  if ((fromNode.type === "STATE" || fromNode.type === "STATE_NOT") && isGate(toNode)) {
    const laneY = metadataNumber(fromNode, "feedbackLaneY") ?? feedbackLaneY(fromNode);
    const busX = edgeNetId === stateSourceNet ? metadataNumber(fromNode, "busX") ?? zone.busStartX : finalNetLaneX;
    const feedbackExitX = metadataNumber(fromNode, "feedbackExitX") ?? from.x + 44;
    if (edgeNetId !== stateSourceNet) {
      const exitX = from.x + 26 + laneIndex * 8;
      return compactPoints([from, { x: exitX, y: from.y }, { x: exitX, y: laneY }, { x: busX, y: laneY }, { x: busX, y: to.y }, to]);
    }
    return compactPoints([from, { x: feedbackExitX, y: from.y }, { x: feedbackExitX, y: laneY }, { x: busX, y: laneY }, { x: busX, y: to.y }, to]);
  }

  if ((fromNode.type === "STATE" || fromNode.type === "STATE_NOT") && toNode.type === "FF") {
    const { laneX } = ffInputLane(edge, from, to);
    const leftSafeLaneX = zone.sumX + gateSize("OR").width + routingChannelX + 18;
    const approachLaneX = Math.max(leftSafeLaneX, Math.min(laneX, zone.ffApproachX - laneIndex * 10));
    const bottomLaneY = Math.max(from.y, to.y, toNode.y + (toNode.height ?? ffHeight)) + 90 + laneIndex * 14;
    const sourceIsStateNet = edgeNetId === stateSourceNet;
    const exitX = sourceIsStateNet ? metadataNumber(fromNode, "feedbackExitX") ?? from.x + 44 : from.x + 86 + laneIndex * 10;
    return compactPoints([
      from,
      { x: exitX, y: from.y },
      { x: exitX, y: bottomLaneY },
      { x: approachLaneX, y: bottomLaneY },
      { x: approachLaneX, y: to.y },
      to,
    ]);
  }

  if ((fromNode.type === "STATE" || fromNode.type === "STATE_NOT") && toNode.type === "OUTPUT") {
    const laneY = metadataNumber(fromNode, "feedbackLaneY") ?? feedbackLaneY(fromNode);
    const busX = metadataNumber(fromNode, "busX") ?? zone.busStartX;
    const exitX = edgeNetId === stateSourceNet ? metadataNumber(fromNode, "feedbackExitX") ?? from.x + 44 : from.x + 26 + laneIndex * 8;
    return compactPoints([from, { x: exitX, y: from.y }, { x: exitX, y: laneY }, { x: busX, y: laneY }, { x: busX, y: to.y }, to]);
  }

  if (fromNode.type === "INPUT" && toNode.type === "NOT") {
    return laneRoute(from, to, to.x - 22);
  }

  if (fromNode.type === "NOT" && toNode.type === "FF") {
    const { laneX } = ffInputLane(edge, from, to);
    const exit = gateOutputExit(from);
    return compactPoints([from, exit, { x: laneX, y: from.y }, { x: laneX, y: to.y }, to]);
  }

  if (fromNode.type === "INPUT" && isGate(toNode)) {
    const busX = metadataNumber(fromNode, "busX") ?? Math.min(from.x + 70, to.x - 90);
    if (toNode.type === "OR") return routeDirectSignalToOr(from, to, busX, toNode, edgeInputIndex(edge));
    return busRoute(from, to, busX);
  }

  if (fromNode.type === "NOT" && isGate(toNode)) {
    const busX = edgeNetId === nodeLabelNet(`${String(fromNode.metadata?.source ?? fromNode.label)}'`)
      ? metadataNumber(fromNode, "busX") ?? Math.min(from.x + 70, to.x - 90)
      : finalNetLaneX;
    const staggerY = from.y + 24 + laneIndex * 10;
    const exitX = from.x + 20 + edgeInputIndex(edge) * 8;
    if (toNode.type === "OR") return routeDirectSignalToOr(from, to, busX, toNode, edgeInputIndex(edge), exitX);
    return compactPoints([from, { x: exitX, y: from.y }, { x: exitX, y: staggerY }, { x: busX, y: staggerY }, { x: busX, y: to.y }, to]);
  }

  if (isGate(fromNode) && isGate(toNode)) {
    const laneX = fromNode.type === "AND" && toNode.type === "OR"
      ? zone.productX + 92 + edgeInputIndex(edge) * 26
      : Math.round((from.x + to.x) / 2);
    return laneRoute(from, to, laneX);
  }

  if (isGate(fromNode) && fromNode.type !== "NOT" && toNode.type === "FF") {
    const { laneX } = ffInputLane(edge, from, to);
    const exit = gateOutputExit(from);
    return compactPoints([from, exit, { x: laneX, y: from.y }, { x: laneX, y: to.y }, to]);
  }

  if (fromNode.type === "INPUT" && toNode.type === "FF") {
    const { laneX } = ffInputLane(edge, from, to);
    const targetPin = edge.toPin ?? String(edge.metadata?.targetPin ?? "");
    const useBottomLane = targetPin === "K" || targetPin === "R";
    const aliasLaneY = useBottomLane
      ? Math.max(from.y, to.y) + 76 + laneIndex * 12
      : Math.min(from.y, to.y) - 72 - laneIndex * 12;
    return compactPoints([from, { x: from.x, y: aliasLaneY }, { x: laneX, y: aliasLaneY }, { x: laneX, y: to.y }, to]);
  }

  if (isGate(fromNode) && toNode.type === "OUTPUT") {
    return gateOutputLaneRoute(from, to, to.x - 38);
  }

  if ((fromNode.type === "INPUT" || fromNode.type === "NOT") && toNode.type === "OUTPUT") {
    const busX = metadataNumber(fromNode, "busX") ?? Math.min(from.x + 70, to.x - 80);
    const sourceNet = fromNode.type === "INPUT"
      ? nodeLabelNet(fromNode.label)
      : nodeLabelNet(`${String(fromNode.metadata?.source ?? fromNode.label)}'`);
    if (edgeNetId !== sourceNet) {
      const sourceRailX = from.x - 28 - laneIndex * 8;
      const aliasLaneY = Math.min(from.y, to.y) - 100 - laneIndex * 14;
      const outputLaneX = to.x - 44 - laneIndex * 8;
      return compactPoints([from, { x: sourceRailX, y: from.y }, { x: sourceRailX, y: aliasLaneY }, { x: outputLaneX, y: aliasLaneY }, { x: outputLaneX, y: to.y }, to]);
    }
    return compactPoints([from, { x: busX, y: from.y }, { x: busX, y: to.y }, to]);
  }

  return routeOrthogonal(from, to);
}

export function routeOrthogonalEdge(edge: CircuitEdge, nodes: CircuitNode[], obstacles: CircuitBounds[], usedSegments: Segment[] = []) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const resolved = resolveEdgeAnchors(edge, nodeById);
  if (!resolved) return [];
  const { fromNode, toNode, sourceAnchor: from, targetAnchor: to } = resolved;

  const activeObstacles = obstacles.filter((bounds) => bounds.id !== fromNode.id && bounds.id !== toNode.id);
  const selectRoute = createRouteCandidateSelector(activeObstacles, usedSegments, edge.netId ?? edge.from);

  if (fromNode.type === "FF" && (toNode.type === "STATE" || toNode.type === "STATE_NOT")) {
    const stateTap = compactPoints([from, { x: to.x, y: from.y }, to]);
    if (selectRoute.isPreferred(stateTap)) return stateTap;
  }

  if ((fromNode.type === "STATE" || fromNode.type === "STATE_NOT") && (toNode.type === "AND" || toNode.type === "OR" || toNode.type === "NOT")) {
    const preferredY = feedbackLaneY(fromNode);
    const fallbackYs = [
      preferredY,
      preferredY - feedbackLaneStep,
      preferredY + feedbackLaneStep,
      preferredY - feedbackLaneStep * 2,
      preferredY + feedbackLaneStep * 2,
      preferredY - feedbackLaneStep * 3,
      preferredY + feedbackLaneStep * 3,
      preferredY - feedbackLaneStep * 4,
      preferredY + feedbackLaneStep * 4,
      preferredY - feedbackLaneStep * 5,
      preferredY + feedbackLaneStep * 5,
    ].filter((y) => y >= 24);
    const preferredFeedback = pathWithChannel(from, to, fromNode, toNode, preferredY, 60);
    if (selectRoute.isPreferred(preferredFeedback)) return preferredFeedback;
    for (const channelY of fallbackYs) {
      for (const approachOffset of [360, 332, 304, 276, 248, 220, 192, 164, 136, 108, 80, 60, 40, routingChannelX]) {
        const candidate = pathWithChannel(from, to, fromNode, toNode, channelY, approachOffset);
        if (selectRoute.isPreferred(candidate)) return candidate;
      }
    }
    const feedbackFallback = selectRoute.fallback();
    if (feedbackFallback) return feedbackFallback;
  }

  if (isGate(fromNode) && isGate(toNode)) {
    // Gate-to-gate wires (e.g. an AND product term feeding an OR sum) drop down a
    // dedicated vertical lane. When the default lane collides with another net,
    // shift the lane sideways until an unused track is found so product terms
    // reach separate OR inputs instead of merging onto a shared segment.
    const baseLaneX = fromNode.type === "AND" && toNode.type === "OR"
      ? zone.productX + 92 + edgeInputIndex(edge) * 26
      : Math.round((from.x + to.x) / 2);
    const minLaneX = gateOutputExit(from).x;
    for (let step = 0; step <= 20; step += 1) {
      for (const direction of step === 0 ? [0] : [1, -1]) {
        const laneX = Math.max(minLaneX, baseLaneX + direction * step * channelStep);
        const candidate = laneRoute(from, to, laneX);
        if (selectRoute.isPreferred(candidate)) return candidate;
      }
    }
  }

  const bends = obstacleBendXCandidates(from, to, activeObstacles);
  for (const bendX of bends) {
    const candidate = routeOrthogonal(from, to, bendX);
    if (selectRoute.isPreferred(candidate)) return candidate;
  }

  const channels = obstacleChannelCandidates(from, to, activeObstacles);
  const approachOffsets = [routingChannelX, 44, 68, 92, 116, 140, 164, 188, 212, 236, 260];
  for (const channelY of channels) {
    for (const approachOffset of approachOffsets) {
      const candidate = pathWithChannel(from, to, fromNode, toNode, channelY, approachOffset);
      if (selectRoute.isPreferred(candidate)) return candidate;
    }
  }

  return selectRoute.fallback() ?? pathWithChannel(from, to, fromNode, toNode, channels[0] ?? Math.min(from.y, to.y) - routingChannelY);
}

function routeEdges(edges: CircuitEdge[], nodes: CircuitNode[], rawBounds: CircuitBounds[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const usedSegments: Segment[] = [];
  for (const edge of edges) {
    const resolved = resolveEdgeAnchors(edge, nodeById);
    if (resolved) {
      edge.sourceAnchor = resolved.sourceAnchor;
      edge.targetAnchor = resolved.targetAnchor;
    }
    edge.wireId = makeWireId(edge);
    // Each wire belongs to exactly one net. Only wires of the same net may share
    // a segment (they carry the same signal); different nets must be rerouted.
    const netSignalId = edge.netId ?? edge.from;
    const deterministicPoints = deterministicRouteEdge(edge, nodes);
    const activeBounds = resolved ? rawBounds.filter((bounds) => bounds.id !== resolved.fromNode.id && bounds.id !== resolved.toNode.id) : rawBounds;
    const deterministicConflicts =
      pathIntersectsObstacles(deterministicPoints, activeBounds) ||
      pathOverlapsSegments(deterministicPoints, usedSegments, netSignalId);
    const routedPoints = deterministicConflicts
      ? routeOrthogonalEdge(edge, nodes, rawBounds, usedSegments)
      : deterministicPoints;
    edge.points = flattenPoints(routedPoints);
    usedSegments.push(
      ...pointsToSegments(routedPoints).map((segment) => ({
        ...segment,
        signalId: netSignalId,
      })),
    );
    validateWire(edge);
  }
}

function nodeLabelNet(label: string) {
  return label.replace(/'/g, "_NOT").replace(/_/g, "").toUpperCase();
}

export function validateCircuitGraph(graph: CircuitGraph) {
  const errors: string[] = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgesByTarget = new Map<string, CircuitEdge[]>();
  const edgesBySource = new Map<string, CircuitEdge[]>();
  for (const edge of graph.edges) {
    edgesByTarget.set(edge.to, [...(edgesByTarget.get(edge.to) ?? []), edge]);
    edgesBySource.set(edge.from, [...(edgesBySource.get(edge.from) ?? []), edge]);
    if (!edge.netId) errors.push(`Wire ${edge.id ?? `${edge.from}->${edge.to}`} has no netId.`);
  }

  for (const state of graph.metadata.stateVariables) {
    const qEdge = graph.edges.find((edge) => edge.from === `ff:${state}` && edge.to === `state:${state}` && edge.fromPin === "Q");
    const qBarEdge = graph.edges.find((edge) => edge.from === `ff:${state}` && edge.to === `state-not:${state}` && edge.fromPin === "Q'");
    const usesQ = graph.edges.some((edge) => edge.from === `state:${state}`);
    const usesQBar = graph.edges.some((edge) => edge.from === `state-not:${state}`);
    if (usesQ && qEdge?.netId !== nodeLabelNet(state)) errors.push(`FF_${state}.Q must drive net ${state}, got ${qEdge?.netId ?? "missing"}.`);
    if (usesQBar && qBarEdge?.netId !== nodeLabelNet(`${state}'`)) errors.push(`FF_${state}.Q' must drive net ${state}', got ${qBarEdge?.netId ?? "missing"}.`);
  }

  for (const output of graph.metadata.outputVariables) {
    if (!edgesByTarget.get(`output:${output}`)?.length) errors.push(`Output ${output} is floating.`);
  }

  for (const node of graph.nodes) {
    if (!isGate(node)) continue;
    if (!(edgesByTarget.get(node.id)?.length)) errors.push(`Gate ${node.id} has no input net.`);
    if (!(edgesBySource.get(node.id)?.length)) errors.push(`Gate ${node.id} output is floating.`);
  }

  const stateNets = graph.metadata.stateVariables.flatMap((state) => [nodeLabelNet(state), nodeLabelNet(`${state}'`)]);
  const stateNetSegments = graph.edges
    .filter((edge) => edge.netId && stateNets.includes(edge.netId))
    .flatMap((edge) =>
      pointsToSegments(pointsFromFlat(edge.points)).map((segment) => ({ ...segment, netId: edge.netId!, wireId: edge.wireId ?? edge.id })),
    );
  for (let index = 0; index < stateNetSegments.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < stateNetSegments.length; otherIndex += 1) {
      const segment = stateNetSegments[index];
      const other = stateNetSegments[otherIndex];
      if (segment.netId === other.netId) continue;
      if (segmentsOverlap(segment, other)) errors.push(`State feedback nets ${segment.netId} and ${other.netId} share a wire segment.`);
    }
  }

  const allSegments = graph.edges.flatMap((edge) =>
    pointsToSegments(pointsFromFlat(edge.points)).map((segment) => ({ ...segment, netId: edge.netId ?? "", wireId: edge.wireId ?? edge.id })),
  );
  for (let index = 0; index < allSegments.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < allSegments.length; otherIndex += 1) {
      const segment = allSegments[index];
      const other = allSegments[otherIndex];
      if (!segment.netId || !other.netId || segment.netId === other.netId) continue;
      if (segmentsOverlap(segment, other)) errors.push(`Different nets ${segment.netId} and ${other.netId} share wire segment ${segment.wireId}/${other.wireId}.`);
    }
  }

  const componentBounds = graph.nodes
    .filter((node) => node.type === "AND" || node.type === "OR" || node.type === "NOT" || node.type === "FF")
    .map((node) => expandBounds(getNodeBounds(node), 4));
  for (const edge of graph.edges) {
    const points = pointsFromFlat(edge.points);
    const activeBounds = componentBounds.filter((bounds) => bounds.id !== edge.from && bounds.id !== edge.to);
    if (pathIntersectsObstacles(points, activeBounds)) {
      errors.push(`Wire ${edge.wireId ?? edge.id ?? `${edge.from}->${edge.to}`} crosses a component body.`);
    }
  }

  for (const edge of graph.edges) {
    if (edge.netId === "CLK") errors.push(`CLK net must use clock bus only, but edge ${edge.id ?? edge.wireId} is a logic wire.`);
  }
  const flipFlops = graph.nodes.filter((node) => node.type === "FF");
  if (graph.clockLine.branches.length !== flipFlops.length) errors.push(`CLK must have exactly one branch per flip-flop.`);
  for (const branch of graph.clockLine.branches) {
    const [, , pinX, pinY] = branch;
    const hits = flipFlops.filter((node) => {
      const pins = getNodePins(node);
      return pins.pins.CLK.x === pinX && pins.pins.CLK.y === pinY;
    });
    if (hits.length !== 1) errors.push(`CLK branch ending at ${pinX},${pinY} does not connect to exactly one CLK pin.`);
  }

  if (graph.metadata.outputVariables.includes("Z") && !nodesById.has("output:Z")) errors.push("Mealy output Z is missing.");
  return [...new Set(errors)];
}

export function layoutCircuitGraph(graph: CircuitGraph): CircuitGraph {
  const next = cloneGraph(graph);
  const nodeById = new Map(next.nodes.map((node) => [node.id, node]));
  const stageWidth = zone.feedbackBusX + Math.max(120, next.metadata.stateVariables.length * 56 + 96);
  const targetSpacing = next.metadata.flipFlopType === "sr" ? srTargetSlotSpacing : targetSlotSpacing;
  const termSpacing = next.metadata.flipFlopType === "sr" ? srProductTermSpacing : productTermSpacing;
  const pinOrderByType: Record<string, string[]> = {
    jk: ["J", "K"],
    sr: ["S", "R"],
    d: ["D"],
    t: ["T"],
  };
  const pinOrder = pinOrderByType[next.metadata.flipFlopType] ?? ["J", "K"];
  const signalTracks = [
    ...next.metadata.stateVariables.flatMap((state) => [state, `${state}'`]),
    ...next.metadata.inputVariables.flatMap((input) => [input, `${input}'`]),
  ];
  const busXBySignal = new Map(signalTracks.map((signal, index) => [signal, zone.busStartX + index * zone.busTrackStep]));
  const targetStartY = Math.max(layoutTop, feedbackTopY + next.metadata.stateVariables.length * 2 * feedbackLaneStep + 86);
  const targetEdges = next.edges.filter((edge) => splitTarget(edge));
  const targetRank = (edge: CircuitEdge) => {
    const target = splitTarget(edge);
    if (!target) return 10000;
    if (target.kind === "ff") {
      const stateIndex = next.metadata.stateVariables.indexOf(target.state);
      const pinIndex = pinOrder.indexOf(target.pin);
      return stateIndex * 10 + (pinIndex < 0 ? 9 : pinIndex);
    }
    const outputIndex = next.metadata.outputVariables.indexOf(target.output);
    return next.metadata.stateVariables.length * 10 + (outputIndex < 0 ? 99 : outputIndex);
  };
  targetEdges.sort((a, b) => targetRank(a) - targetRank(b));
  const productTermCountForTarget = (edge: CircuitEdge) => {
    const sourceNode = nodeById.get(edge.from);
    if (!sourceNode) return 1;
    if (sourceNode.type === "OR") {
      const incomingProducts = next.edges.filter((candidate) => {
        const candidateSource = nodeById.get(candidate.from);
        return candidate.to === sourceNode.id && candidateSource?.type === "AND";
      }).length;
      return Math.max(1, incomingProducts);
    }
    if (sourceNode.type === "AND") return 1;
    return 1;
  };
  const slotYByTargetEdge = new Map<string, number>();
  let targetCursorY = targetStartY;
  targetEdges.forEach((edge) => {
    const productCount = productTermCountForTarget(edge);
    const groupHalfHeight = Math.max(targetSpacing / 2, ((productCount - 1) * termSpacing) / 2 + 58);
    const slotY = targetCursorY + groupHalfHeight;
    slotYByTargetEdge.set(edge.id ?? `${edge.from}->${edge.to}`, slotY);
    targetCursorY = slotY + groupHalfHeight + 56;
  });

  next.metadata.inputVariables.forEach((input, index) => {
    const inputY = targetStartY - 76 + index * 44;
    const inputNode = nodeById.get(`input:${input}`);
    if (inputNode) {
      const busX = zone.inputX + 54 + index * 28;
      Object.assign(inputNode, {
        x: zone.inputX,
        y: inputY,
        width: 1,
        height: 1,
        metadata: {
          ...inputNode.metadata,
          busX,
          labelX: busX - 34,
          labelY: inputY - 8,
        },
      });
    }
    const notNode = nodeById.get(`not:${input}`);
    if (notNode) {
      Object.assign(notNode, {
        x: zone.inputNotX,
        y: inputY - gateSize("NOT").height / 2,
        ...gateSize("NOT"),
        metadata: { ...notNode.metadata, busX: busXBySignal.get(`${input}'`) ?? zone.busStartX + zone.busTrackStep },
      });
    }
  });

  const ffPositions = new Map<string, { x: number; y: number }>();
  let previousFfBottom = 0;
  next.metadata.stateVariables.forEach((state, stateIndex) => {
    const stateTargets = targetEdges
      .map((edge) => ({ edge, target: splitTarget(edge), y: slotYByTargetEdge.get(edge.id ?? `${edge.from}->${edge.to}`) ?? targetStartY }))
      .filter((item) => item.target?.kind === "ff" && item.target.state === state);
    const desiredY = stateTargets.length
      ? stateTargets.reduce((sum, item) => sum + item.y - pinOffset(item.target?.kind === "ff" ? item.target.pin : undefined), 0) / stateTargets.length
      : targetStartY + stateIndex * (ffHeight + 96);
    const y = Math.max(targetStartY - 86, previousFfBottom + 92, Math.round(desiredY));
    previousFfBottom = y + ffHeight;
    ffPositions.set(state, { x: zone.ffX, y });
    const ff = nodeById.get(`ff:${state}`);
    if (ff) Object.assign(ff, { x: zone.ffX, y, width: ffWidth, height: ffHeight });
  });

  next.metadata.stateVariables.forEach((state, stateIndex) => {
    const placement = ffPositions.get(state);
    if (!placement) return;
    const qY = placement.y + 42;
    const qBarY = placement.y + 90;
    const stateNode = nodeById.get(`state:${state}`);
    const stateNotNode = nodeById.get(`state-not:${state}`);
    const stateX = zone.feedbackBusX + stateIndex * 56;
    const stateNotX = stateX + 24;
    const stateBusX = busXBySignal.get(state) ?? zone.busStartX;
    const stateNotBusX = busXBySignal.get(`${state}'`) ?? zone.busStartX;
    const stateLaneY = feedbackTopY + stateIndex * 2 * feedbackLaneStep;
    const stateNotLaneY = feedbackTopY + (stateIndex * 2 + 1) * feedbackLaneStep;
    if (stateNode) {
      Object.assign(stateNode, {
        x: stateX,
        y: qY,
        width: 1,
        height: 1,
        metadata: {
          ...stateNode.metadata,
          busX: stateBusX,
          feedbackExitX: stateX + 44,
          feedbackLane: stateIndex * 2,
          feedbackLaneY: stateLaneY,
        },
      });
    }
    if (stateNotNode) {
      Object.assign(stateNotNode, {
        x: stateNotX,
        y: qBarY,
        width: 1,
        height: 1,
        metadata: {
          ...stateNotNode.metadata,
          busX: stateNotBusX,
          feedbackExitX: stateNotX + 44,
          feedbackLane: stateIndex * 2 + 1,
          feedbackLaneY: stateNotLaneY,
        },
      });
    }
  });

  const incomingByTarget = new Map<string, CircuitEdge[]>();
  for (const edge of next.edges) {
    const list = incomingByTarget.get(edge.to) ?? [];
    list.push(edge);
    incomingByTarget.set(edge.to, list);
  }
  const placedGates = new Set<string>();
  const placeGate = (node: CircuitNode, centerX: number, centerY: number) => {
    if (node.id.startsWith("not:")) return;
    const size = gateSize(node.type);
    Object.assign(node, { x: centerX, y: centerY - size.height / 2, ...size });
    placedGates.add(node.id);
  };
  const placeUpstreamGates = (parentNode: CircuitNode, parentCenterY: number) => {
    const incomingGateEdges = (incomingByTarget.get(parentNode.id) ?? []).filter((edge) => {
      const source = nodeById.get(edge.from);
      return isGate(source) && !source?.id.startsWith("not:");
    });
    incomingGateEdges.forEach((edge, index) => {
      const source = nodeById.get(edge.from);
      if (!source || placedGates.has(source.id)) return;
      const centerOffset = (index - (incomingGateEdges.length - 1) / 2) * termSpacing;
      const centerX = parentNode.type === "OR" ? zone.productX : Math.max(zone.busStartX + signalTracks.length * zone.busTrackStep + 72, parentNode.x - 142);
      const centerY = parentCenterY + centerOffset;
      placeGate(source, centerX, centerY);
      placeUpstreamGates(source, centerY);
    });
  };

  for (const edge of targetEdges) {
    const sourceNode = nodeById.get(edge.from);
    if (!sourceNode || !isGate(sourceNode) || sourceNode.id.startsWith("not:")) continue;
    const slotY = slotYByTargetEdge.get(edge.id ?? `${edge.from}->${edge.to}`) ?? targetStartY;
    const centerX = sourceNode.type === "OR" ? zone.sumX : sourceNode.type === "AND" ? zone.productX : zone.productX;
    placeGate(sourceNode, centerX, slotY);
    placeUpstreamGates(sourceNode, slotY);
  }

  const gateInputCounts = new Map<string, number>();
  for (const edge of next.edges) {
    const toNode = nodeById.get(edge.to);
    if (toNode?.type === "AND" || toNode?.type === "OR" || toNode?.type === "NOT") {
      gateInputCounts.set(toNode.id, (gateInputCounts.get(toNode.id) ?? 0) + 1);
    }
  }

  const upstreamGateCounts = new Map<string, number>();
  for (const edge of next.edges) {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if ((fromNode?.type === "AND" || fromNode?.type === "OR" || fromNode?.type === "NOT") && (toNode?.type === "AND" || toNode?.type === "OR" || toNode?.type === "NOT")) {
      upstreamGateCounts.set(toNode.id, (upstreamGateCounts.get(toNode.id) ?? 0) + 1);
    }
  }

  const gateInputs = new Map<string, number>();
  for (const edge of next.edges) {
    const toNode = nodeById.get(edge.to);
    const fromNode = nodeById.get(edge.from);
    if (!toNode || !fromNode) continue;
    if (!(toNode.type === "AND" || toNode.type === "OR" || toNode.type === "NOT")) continue;
    const inputIndex = gateInputs.get(toNode.id) ?? 0;
    gateInputs.set(toNode.id, inputIndex + 1);
    edge.metadata = {
      ...edge.metadata,
      gateInputIndex: inputIndex,
      gateInputCount: gateInputCounts.get(toNode.id) ?? 1,
    };
    if (fromNode.type === "AND" || fromNode.type === "OR" || fromNode.type === "NOT") continue;
    if (fromNode.x || fromNode.y) continue;
    const anchor = inputAnchor(toNode, undefined, inputIndex, gateInputCounts.get(toNode.id) ?? 1);
    Object.assign(fromNode, { x: toNode.x - 84 - inputIndex * 18, y: anchor.y, width: 1, height: 1 });
  }

  const upstreamGateIndexes = new Map<string, number>();
  for (const node of next.nodes) {
    if (!(node.type === "AND" || node.type === "OR" || node.type === "NOT")) continue;
    if (node.x || node.y) continue;
    const outgoing = next.edges.find((edge) => edge.from === node.id);
    const toNode = outgoing ? nodeById.get(outgoing.to) : undefined;
    const size = gateSize(node.type);
    const parentId = toNode?.id ?? "output";
    const siblingCount = upstreamGateCounts.get(parentId) ?? 1;
    const siblingIndex = upstreamGateIndexes.get(parentId) ?? 0;
    upstreamGateIndexes.set(parentId, siblingIndex + 1);
    const siblingOffset = (siblingIndex - (siblingCount - 1) / 2) * (size.height + routingChannelY);
    Object.assign(node, {
      x: (toNode?.x ?? stageWidth - 260) - 130,
      y: (toNode ? inputAnchor(toNode, outgoing?.toPin).y : 260) - size.height / 2 + siblingOffset,
      ...size,
    });
  }

  next.metadata.outputVariables.forEach((output, index) => {
    const outputNode = nodeById.get(`output:${output}`);
    const outputEdge = targetEdges.find((edge) => {
      const target = splitTarget(edge);
      return target?.kind === "output" && target.output === output;
    });
    const outputY = outputEdge ? slotYByTargetEdge.get(outputEdge.id ?? `${outputEdge.from}->${outputEdge.to}`) ?? targetStartY : targetStartY + (targetEdges.length + index) * targetSpacing;
    if (outputNode) Object.assign(outputNode, { x: zone.outputX, y: outputY, width: 1, height: 1 });
  });

  const routingBounds = next.nodes.map(getNodeBounds);
  routeEdges(next.edges, next.nodes, routingBounds);

  const contentBottom = Math.max(
    ...next.nodes.map((node) => node.y + (node.height ?? 1)),
    ...next.edges.flatMap((edge) => pointsFromFlat(edge.points).map((point) => point.y)),
  );
  const clockY = contentBottom + clockGap;
  const clockStartX = 54;
  const clockEndX = zone.ffX + ffWidth / 2 + 70;
  next.clockLine = {
    label: graph.clockLine.label,
    points: [clockStartX, clockY, clockEndX, clockY],
    branches: next.metadata.stateVariables.flatMap((state) => {
      const placement = ffPositions.get(state);
      if (!placement) return [];
      const pinX = placement.x + ffWidth / 2;
      return [[pinX, clockY, pinX, placement.y + ffHeight]];
    }),
  };
  next.metadata.width = stageWidth;
  next.metadata.height = clockY + 72;
  next.metadata.generatedAt = new Date().toISOString();
  next.metadata.routingBounds = routingBounds;
  next.metadata.validationErrors = validateCircuitGraph(next);
  return next;
}

function svgPoints(points: number[]) {
  const pairs: string[] = [];
  for (let index = 0; index < points.length; index += 2) pairs.push(`${points[index]},${points[index + 1]}`);
  return pairs.join(" ");
}

function pointsFromFlat(points?: number[]) {
  const result: Point[] = [];
  if (!points) return result;
  for (let index = 0; index < points.length; index += 2) result.push({ x: points[index], y: points[index + 1] });
  return result;
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

function pointKey(point: Point) {
  return `${Math.round(point.x)},${Math.round(point.y)}`;
}

function normalizePoint(point: Point) {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

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

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function svgFormulaText(x: number, y: number, label: string, size = 13) {
  const [main, sub] = label.split("_");
  const mainText = `<text x="${x}" y="${y + size}" font-family="Times New Roman" font-size="${size}" font-style="italic" font-weight="700" fill="#334155">${escapeXml(main)}</text>`;
  if (!sub) return mainText;
  return `${mainText}<text x="${x + size * 0.62}" y="${y + size * 1.17}" font-family="Times New Roman" font-size="${size * 0.62}" font-style="italic" font-weight="700" fill="#334155">${escapeXml(sub)}</text>`;
}

const svgWireColor = "#1e293b";
const svgClockColor = "#2563eb";

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
