// Zone-based placement of the circuit graph: inputs/NOTs on the left, product (AND)
// and sum (OR) gates in the middle, flip-flops and outputs on the right, then route.
import type { CircuitEdge, CircuitGraph, CircuitNode } from "../../types";
import {
  clockGap,
  feedbackLaneStep,
  feedbackTopY,
  ffHeight,
  ffWidth,
  layoutTop,
  productTermSpacing,
  routingChannelY,
  srProductTermSpacing,
  srTargetSlotSpacing,
  targetSlotSpacing,
  zone,
} from "./constants";
import { pointsFromFlat } from "./geometry";
import { gateSize, getNodeBounds, inputAnchor, isGate, pinOffset } from "./pins";
import { routeEdges } from "./routing";
import { validateCircuitGraph } from "./validation";

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
