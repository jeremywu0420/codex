// Orthogonal wire routing: deterministic per-edge routes plus an obstacle/overlap
// aware fallback router. Same-net wires may share a segment; different nets never do.
import type { CircuitBounds, CircuitEdge, CircuitNode } from "../../types";
import { channelStep, feedbackLaneStep, ffHeight, routingChannelX, routingChannelY, zone } from "./constants";
import type { Point, Segment } from "./geometry";
import {
  compactPoints,
  distance,
  flatPointAt,
  flattenPoints,
  pathIntersectsObstacles,
  pathOverlapsSegments,
  pointsToSegments,
} from "./geometry";
import { gateSize, inputAnchor, isGate, metadataNumber, outputAnchor } from "./pins";
import { makeWireId, nodeLabelNet } from "./nets";

function routeOrthogonal(from: Point, to: Point, bendX?: number) {
  const midX = bendX ?? Math.round((from.x + to.x) / 2);
  return compactPoints([from, { x: midX, y: from.y }, { x: midX, y: to.y }, to]);
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

function constantValueOf(nodeOrEdge?: CircuitNode | CircuitEdge): "0" | "1" | null {
  const value = nodeOrEdge?.metadata?.constantValue ?? nodeOrEdge?.metadata?.pinValue;
  return value === "0" || value === "1" ? value : null;
}

function isConstantPinEdge(edge: CircuitEdge, fromNode?: CircuitNode, toNode?: CircuitNode) {
  return Boolean((constantValueOf(edge) ?? constantValueOf(fromNode)) && toNode?.type === "FF");
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

  if (isConstantPinEdge(edge, fromNode, toNode)) {
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

  // Last resort before giving up: sweep a dense set of vertical lanes across the
  // whole source-to-target corridor. Two different nets must never be forced to
  // share a segment, so prefer any obstacle-clear, overlap-free lane over the
  // generic fallback (which only guarantees obstacle clearance).
  const corridorStart = Math.min(from.x, to.x);
  const corridorEnd = Math.max(from.x, to.x);
  for (let bendX = corridorStart; bendX <= corridorEnd; bendX += 6) {
    const candidate = routeOrthogonal(from, to, bendX);
    if (selectRoute.isPreferred(candidate)) return candidate;
  }

  return selectRoute.fallback() ?? pathWithChannel(from, to, fromNode, toNode, channels[0] ?? Math.min(from.y, to.y) - routingChannelY);
}

export function routeEdges(edges: CircuitEdge[], nodes: CircuitNode[], rawBounds: CircuitBounds[]) {
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
