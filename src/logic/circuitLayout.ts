import type { CircuitBounds, CircuitEdge, CircuitGraph, CircuitNode, CircuitPoint } from "../types";

const ffWidth = 126;
const ffHeight = 124;
const ffTop = 196;
const ffSpacing = 520;
const rightPadding = 116;
const inputBusX = 54;
const inputNotX = 126;
const obstaclePadding = 12;
const wireClearance = 8;
const routingChannelY = 24;
const routingChannelX = 20;
const channelStep = 24;
const feedbackLaneStep = 18;

type Point = CircuitPoint;
type Segment = { from: Point; to: Point; signalId?: string };
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

function pinRoutingOffset(pin?: string) {
  if (pin === "J" || pin === "S") return -36;
  if (pin === "K" || pin === "R") return 36;
  return 0;
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
    const inputX = node.type === "OR" ? node.x + 18 : node.x + 2;
    const inputPins = Array.from({ length: Math.max(1, inputCount) }, (_, index) => ({
      x: inputX,
      y: gateInputY(node, index, Math.max(1, inputCount)),
    }));
    const outputInset = node.type === "OR" ? 18 : 28;
    const outputPin = { x: node.x + width - outputInset, y: node.y + height / 2 };
    return { inputPins, outputPin, pins: { output: outputPin, out: outputPin } };
  }
  if (node.type === "NOT") {
    const inputPin = { x: node.x + 2, y: node.y + height / 2 };
    const outputPin = { x: node.x + 31, y: node.y + height / 2 };
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
  return { id: node.id, x: node.x + 8, y: node.y - 11, width, height: 14, padding: 0 };
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
  const exitX = from.x + (sourceNeedsExit ? routingChannelX : 0);
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
  const lane = Number(node.metadata?.feedbackLane ?? 0);
  return node.type === "STATE_NOT" ? 384 + lane * feedbackLaneStep : 96 + lane * feedbackLaneStep;
}

function sanitizeWireId(value: string) {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function makeWireId(edge: CircuitEdge) {
  const fromPin = edge.fromPin ?? "out";
  const toPin = edge.toPin ?? (typeof edge.metadata?.gateInputIndex === "number" ? `in${edge.metadata.gateInputIndex}` : "in");
  return sanitizeWireId(`${edge.from}_${fromPin}_to_${edge.to}_${toPin}`);
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

export function routeOrthogonalEdge(edge: CircuitEdge, nodes: CircuitNode[], obstacles: CircuitBounds[], usedSegments: Segment[] = []) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const resolved = resolveEdgeAnchors(edge, nodeById);
  if (!resolved) return [];
  const { fromNode, toNode, sourceAnchor: from, targetAnchor: to } = resolved;

  const activeObstacles = obstacles.filter((bounds) => bounds.id !== fromNode.id && bounds.id !== toNode.id);
  const selectRoute = createRouteCandidateSelector(activeObstacles, usedSegments, edge.from);

  if (fromNode.type === "FF" && (toNode.type === "STATE" || toNode.type === "STATE_NOT")) {
    const stateTap = compactPoints([from, { x: to.x, y: from.y }, to]);
    if (selectRoute.isPreferred(stateTap)) return stateTap;
  }

  if ((fromNode.type === "STATE" || fromNode.type === "STATE_NOT") && (toNode.type === "AND" || toNode.type === "OR" || toNode.type === "NOT")) {
    const preferredY = feedbackLaneY(fromNode);
    const fallbackYs = fromNode.type === "STATE_NOT"
      ? [preferredY, 384, 384 + feedbackLaneStep, 384 + feedbackLaneStep * 2, 384 + feedbackLaneStep * 3, 360, 336]
      : [preferredY, 96, 96 + feedbackLaneStep, 96 + feedbackLaneStep * 2, 96 + feedbackLaneStep * 3, 128, 152];
    const preferredFeedback = pathWithChannel(from, to, fromNode, toNode, preferredY, 60);
    if (selectRoute.isPreferred(preferredFeedback)) return preferredFeedback;
    for (const channelY of fallbackYs) {
      for (const approachOffset of [220, 180, 140, 100, 60, routingChannelX]) {
        const candidate = pathWithChannel(from, to, fromNode, toNode, channelY, approachOffset);
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
  const obstacles = rawBounds.map((bounds) => expandBounds(bounds, (bounds.padding ?? 0) + wireClearance));
  const usedSegments: Segment[] = [];
  for (const edge of edges) {
    const resolved = resolveEdgeAnchors(edge, nodeById);
    if (resolved) {
      edge.sourceAnchor = resolved.sourceAnchor;
      edge.targetAnchor = resolved.targetAnchor;
    }
    edge.wireId = makeWireId(edge);
    const routedPoints = routeOrthogonalEdge(edge, nodes, obstacles, usedSegments);
    edge.points = flattenPoints(routedPoints);
    usedSegments.push(...pointsToSegments(routedPoints).map((segment) => ({ ...segment, signalId: edge.from })));
    validateWire(edge);
  }
}

export function layoutCircuitGraph(graph: CircuitGraph): CircuitGraph {
  const next = cloneGraph(graph);
  const nodeById = new Map(next.nodes.map((node) => [node.id, node]));
  const stageWidth = Math.max(1040, 280 + next.metadata.stateVariables.length * ffSpacing + 210);
  const stageHeight = 520;
  const clockY = 418;
  const statesLeftToRight = [...next.metadata.stateVariables].reverse();
  const ffPositions = new Map<string, { x: number; y: number }>();
  const targetGateIndexes = new Map<string, number>();

  statesLeftToRight.forEach((state, index) => {
    const x = stageWidth - rightPadding - ffWidth - (statesLeftToRight.length - 1 - index) * ffSpacing;
    ffPositions.set(state, { x, y: ffTop });
    const ff = nodeById.get(`ff:${state}`);
    if (ff) Object.assign(ff, { x, y: ffTop, width: ffWidth, height: ffHeight });
  });

  next.metadata.inputVariables.forEach((input, index) => {
    const inputNode = nodeById.get(`input:${input}`);
    if (inputNode) Object.assign(inputNode, { x: inputBusX, y: 64 + index * 72, width: 1, height: 1 });
    const notNode = nodeById.get(`not:${input}`);
    if (notNode) Object.assign(notNode, { x: inputNotX, y: 82 + index * 72, ...gateSize("NOT") });
  });

  next.metadata.stateVariables.forEach((state, index) => {
    const placement = ffPositions.get(state);
    if (!placement) return;
    const qY = placement.y + 42;
    const qBarY = placement.y + 90;
    const stateNode = nodeById.get(`state:${state}`);
    const stateNotNode = nodeById.get(`state-not:${state}`);
    if (stateNode) Object.assign(stateNode, { x: placement.x + ffWidth + 44, y: qY, width: 1, height: 1, metadata: { ...stateNode.metadata, feedbackLane: index } });
    if (stateNotNode) Object.assign(stateNotNode, { x: placement.x + ffWidth + 64, y: qBarY, width: 1, height: 1, metadata: { ...stateNotNode.metadata, feedbackLane: index } });
  });

  const targetEdges = next.edges.filter((edge) => splitTarget(edge));
  for (const edge of targetEdges) {
    const target = splitTarget(edge);
    const sourceNode = nodeById.get(edge.from);
    if (!target || !sourceNode) continue;

    let targetX = stageWidth - 112;
    let targetY = 454;
    if (target.kind === "ff") {
      const placement = ffPositions.get(target.state);
      if (!placement) continue;
      targetX = placement.x;
      targetY = placement.y + pinOffset(target.pin);
    }

    const targetKey = target.kind === "ff" ? `${target.state}:${target.pin}` : `output:${target.output}`;
    const localIndex = targetGateIndexes.get(targetKey) ?? 0;
    targetGateIndexes.set(targetKey, localIndex + 1);

    if (sourceNode.type === "AND" || sourceNode.type === "OR" || sourceNode.type === "NOT") {
      const size = gateSize(sourceNode.type);
      Object.assign(sourceNode, {
        x: targetX - (sourceNode.type === "OR" ? 112 : 104),
        y: targetY - size.height / 2 + localIndex * (size.height + routingChannelY) + (target.kind === "ff" ? pinRoutingOffset(target.pin) : 0),
        ...size,
      });
    }
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
    if (outputNode) Object.assign(outputNode, { x: stageWidth - 54, y: 454 + index * 28, width: 1, height: 1 });
  });

  const routingBounds = next.nodes.map(getNodeBounds);
  routeEdges(next.edges, next.nodes, routingBounds);

  const clockStartX = 54;
  const clockEndX = stageWidth - 120;
  next.clockLine = {
    label: graph.clockLine.label,
    points: [clockStartX, clockY, clockEndX, clockY],
    branches: statesLeftToRight.flatMap((state) => {
      const placement = ffPositions.get(state);
      if (!placement) return [];
      const pinX = placement.x + ffWidth / 2;
      return [[pinX, clockY, pinX, placement.y + ffHeight]];
    }),
  };
  next.metadata.width = stageWidth;
  next.metadata.height = stageHeight;
  next.metadata.generatedAt = new Date().toISOString();
  next.metadata.routingBounds = routingBounds;
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

function pointKey(point: Point) {
  return `${Math.round(point.x)},${Math.round(point.y)}`;
}

function addDot(dots: Map<string, { x: number; y: number; count: number }>, point: Point) {
  const key = pointKey(point);
  const existing = dots.get(key);
  dots.set(key, { x: point.x, y: point.y, count: (existing?.count ?? 0) + 1 });
}

function isCorner(previous: Point, point: Point, next: Point) {
  const incomingHorizontal = previous.y === point.y;
  const outgoingHorizontal = point.y === next.y;
  const incomingVertical = previous.x === point.x;
  const outgoingVertical = point.x === next.x;
  return (incomingHorizontal && outgoingVertical) || (incomingVertical && outgoingHorizontal);
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

export function collectWireJunctionDots(graph: CircuitGraph) {
  const endpointCounts = new Map<string, { x: number; y: number; count: number }>();
  const dots = new Map<string, { x: number; y: number; count: number }>();
  const bodyBounds = componentBodyBounds(graph);
  const addVisibleDot = (point: Point) => {
    if (bodyBounds.some((bounds) => pointIsInsideBounds(point, bounds))) return;
    addDot(dots, point);
  };

  for (const edge of graph.edges) {
    for (const anchor of [edge.sourceAnchor, edge.targetAnchor]) {
      if (!anchor) continue;
      addDot(endpointCounts, anchor);
    }
    const points = pointsFromFlat(edge.points);
    for (let index = 1; index < points.length - 1; index += 1) {
      if (isCorner(points[index - 1], points[index], points[index + 1])) addVisibleDot(points[index]);
    }
  }
  for (const point of endpointCounts.values()) {
    if (point.count > 1) addVisibleDot(point);
  }
  return [...dots.values()];
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
    return `<path d="M${node.x} ${node.y} L${node.x + 30} ${node.y} Q${node.x + 66} ${node.y + 22} ${node.x + 30} ${node.y + 44} L${node.x} ${node.y + 44} Z" stroke="#64748b" stroke-width="1.45" fill="white"/>`;
  }
  if (node.type === "OR") {
    return `<path d="M${node.x} ${node.y} Q${node.x + 44} ${node.y + 5} ${node.x + 86} ${node.y + 30} Q${node.x + 44} ${node.y + 55} ${node.x} ${node.y + 60} Q${node.x + 22} ${node.y + 30} ${node.x} ${node.y} Z" stroke="#64748b" stroke-width="1.45" fill="white"/>`;
  }
  if (node.type === "NOT") {
    return `<path d="M${node.x} ${node.y} L${node.x + 30} ${node.y + 15} L${node.x} ${node.y + 30} Z" stroke="#64748b" stroke-width="1.35" fill="white"/><circle cx="${node.x + 35}" cy="${node.y + 15}" r="4" stroke="#64748b" stroke-width="1.35" fill="white"/>`;
  }
  return "";
}

function svgFlipFlopBody(node: CircuitNode) {
  return `<rect x="${node.x}" y="${node.y}" width="${node.width ?? ffWidth}" height="${node.height ?? ffHeight}" rx="2" fill="white" stroke="#64748b" stroke-width="1.55"/><polyline points="${node.x + 50},${node.y + 124} ${node.x + 63},${node.y + 112} ${node.x + 76},${node.y + 124}" fill="none" stroke="#64748b" stroke-width="1.35"/>`;
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
      `<text x="${node.x + 48}" y="${node.y + 143}" font-size="13" fill="#334155">CLK</text>`,
    ].join("");
  }
  if (node.type === "AND" || node.type === "OR" || node.type === "NOT") return "";
  return svgFormulaText(node.x + 8, node.y - 11, node.label, 13);
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
    `<text x="${startX + 8}" y="${startY + 24}" font-family="Times New Roman" font-size="16" font-style="italic" fill="#334155">${escapeXml(graph.clockLine.label)}</text>`,
    `<text x="${endX + 8}" y="${endY + 6}" font-family="Times New Roman" font-size="16" font-style="italic" fill="#334155">${escapeXml(graph.clockLine.label)}</text>`,
  ].join("");
}

export function circuitGraphToSvg(graph: CircuitGraph, showRoutingBounds = false) {
  const wires = graph.edges
    .filter((edge) => edge.points?.length)
    .map((edge) => `<polyline data-wire-id="${escapeXml(edge.wireId ?? edge.id ?? "")}" points="${svgPoints(edge.points!)}" fill="none" stroke="#64748b" stroke-width="1.4"/>`)
    .join("");
  const clock = [
    graph.clockLine.points.length ? `<polyline points="${svgPoints(graph.clockLine.points)}" fill="none" stroke="#64748b" stroke-width="1.45"/>` : "",
    ...graph.clockLine.branches.map(
      (branch) =>
        `<polyline points="${svgPoints(branch)}" fill="none" stroke="#64748b" stroke-width="1.45"/>`,
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
    ...graph.clockLine.branches.map((branch) => `<circle cx="${branch[0]}" cy="${branch[1]}" r="3" fill="#111827"/>`),
    ...collectWireJunctionDots(graph).map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3" fill="#111827"/>`),
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${graph.metadata.width}" height="${graph.metadata.height}" viewBox="0 0 ${graph.metadata.width} ${graph.metadata.height}" style="overflow:visible"><rect x="0" y="0" width="${graph.metadata.width}" height="${graph.metadata.height}" fill="white"/>${wires}${clock}${gateBodies}${flipFlopBodies}${debugBounds}${labels}${junctionDots}</svg>`;
}
