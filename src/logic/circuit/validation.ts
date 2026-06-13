// Structural validation of a laid-out circuit graph (floating pins, shared
// segments across different nets, wires crossing component bodies, clock wiring).
import type { CircuitEdge, CircuitGraph } from "../../types";
import { expandBounds, pathIntersectsObstacles, pointsFromFlat, pointsToSegments, segmentsOverlap } from "./geometry";
import { getNodeBounds, getNodePins, isGate } from "./pins";
import { nodeLabelNet } from "./nets";

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
