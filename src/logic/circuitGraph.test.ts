import { describe, expect, it } from "vitest";
import { parseBooleanEquation } from "./booleanParser";
import { buildCircuitGraph } from "./circuitGraph";
import {
  circuitGraphToSvg,
  collectWireJunctionDots,
  expandBounds,
  getCircuitContentBounds,
  getNodeBounds,
  layoutCircuitGraph,
  pathIntersectsObstacles,
  pointsToSegments,
  segmentIntersectsBounds,
  segmentsOverlap,
} from "./circuitLayout";
import type { FlipFlopType, Variables } from "../types";

function variables(states: string[]): Variables {
  return {
    inputs: ["X"],
    states,
    outputs: ["Z"],
    clock: "Clock",
  };
}

function buildAndLayout(flipFlopType: FlipFlopType, states: string[], equations: Record<string, string>) {
  return layoutCircuitGraph(buildCircuitGraph({ equations, flipFlopType, variables: variables(states) }));
}

const circuitFixtures: Array<{
  name: string;
  flipFlopType: FlipFlopType;
  states: string[];
  equations: Record<string, string>;
  expectedPins: string[];
}> = [
  {
    name: "JK",
    flipFlopType: "jk",
    states: ["A", "B", "C"],
    equations: {
      JA: "B + C",
      KA: "B'C",
      JB: "A + C'",
      KB: "AC",
      JC: "A'B",
      KC: "A + B",
      Z: "A + B + C",
    },
    expectedPins: ["J", "K"],
  },
  {
    name: "D",
    flipFlopType: "d",
    states: ["A", "B"],
    equations: {
      DA: "A'B + AB'",
      DB: "A + B",
      Z: "A + B",
    },
    expectedPins: ["D"],
  },
  {
    name: "T",
    flipFlopType: "t",
    states: ["A", "B"],
    equations: {
      TA: "B",
      TB: "A",
      Z: "A + B",
    },
    expectedPins: ["T"],
  },
  {
    name: "SR",
    flipFlopType: "sr",
    states: ["A", "B"],
    equations: {
      SA: "A'B",
      RA: "AB'",
      SB: "A",
      RB: "B'",
      Z: "A + B",
    },
    expectedPins: ["S", "R"],
  },
];

function toPointArray(points: number[]) {
  const pointArray: { x: number; y: number }[] = [];
  for (let index = 0; index < points.length; index += 2) {
    pointArray.push({ x: points[index], y: points[index + 1] });
  }
  return pointArray;
}

function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function expectNoWireObstacleCollisions(graph: ReturnType<typeof buildAndLayout>) {
  const obstacles = graph.nodes.map(getNodeBounds).map((bounds) => expandBounds(bounds, (bounds.padding ?? 0) + 8));

  for (const edge of graph.edges) {
    expect(edge.points).toBeTruthy();
    expect(edge.wireId).toBeTruthy();
    expect(edge.sourceAnchor).toBeTruthy();
    expect(edge.targetAnchor).toBeTruthy();
    const points = toPointArray(edge.points ?? []);
    expect(pointDistance(points[0], edge.sourceAnchor!), edge.id).toBeLessThan(1);
    expect(pointDistance(points[points.length - 1], edge.targetAnchor!), edge.id).toBeLessThan(1);
    const activeObstacles = obstacles.filter((bounds) => bounds.id !== edge.from && bounds.id !== edge.to);
    expect(pathIntersectsObstacles(points, activeObstacles), edge.id).toBe(false);
  }
}

function expectAllWiresAreOrthogonal(graph: ReturnType<typeof buildAndLayout>) {
  for (const edge of graph.edges) {
    const points = toPointArray(edge.points ?? []);
    for (const segment of pointsToSegments(points)) {
      expect(segment.from.x === segment.to.x || segment.from.y === segment.to.y, edge.id).toBe(true);
    }
  }
  for (const segment of pointsToSegments(toPointArray(graph.clockLine.points))) {
    expect(segment.from.x === segment.to.x || segment.from.y === segment.to.y, "CLK").toBe(true);
  }
  for (const branch of graph.clockLine.branches) {
    for (const segment of pointsToSegments(toPointArray(branch))) {
      expect(segment.from.x === segment.to.x || segment.from.y === segment.to.y, "CLK branch").toBe(true);
    }
  }
}

function expectStateOutputBusesArePinned(graph: ReturnType<typeof buildAndLayout>, states: string[]) {
  for (const state of states) {
    const qEdge = graph.edges.find((edge) => edge.from === `ff:${state}` && edge.to === `state:${state}`);
    const qBarEdge = graph.edges.find((edge) => edge.from === `ff:${state}` && edge.to === `state-not:${state}`);
    expect(qEdge?.sourceAnchor?.y, `Q bus ${state}`).toBe(qEdge?.targetAnchor?.y);
    expect(qBarEdge?.sourceAnchor?.y, `Qbar bus ${state}`).toBe(qBarEdge?.targetAnchor?.y);
    expect(qBarEdge?.sourceAnchor?.x, `Qbar source ${state}`).toBeLessThan(qBarEdge?.targetAnchor?.x ?? 0);
  }
}

function expectAllEdgesHaveNetIds(graph: ReturnType<typeof buildAndLayout>) {
  for (const edge of graph.edges) {
    expect(edge.netId, edge.id).toBeTruthy();
  }
}

function longestHorizontalY(points: number[]) {
  let bestLength = -1;
  let bestY = Number.NaN;
  for (let index = 0; index < points.length - 2; index += 2) {
    const x1 = points[index];
    const y1 = points[index + 1];
    const x2 = points[index + 2];
    const y2 = points[index + 3];
    if (y1 !== y2) continue;
    const length = Math.abs(x2 - x1);
    if (length > bestLength) {
      bestLength = length;
      bestY = y1;
    }
  }
  return bestY;
}

function expectFeedbackLanesAreSeparated(graph: ReturnType<typeof buildAndLayout>) {
  const feedbackEdges = graph.edges.filter((edge) => edge.from.startsWith("state:") && edge.to.startsWith("gate:"));
  const lanesByState = new Map<string, number>();
  for (const edge of feedbackEdges) {
    const state = edge.from.slice("state:".length);
    const laneY = longestHorizontalY(edge.points ?? []);
    if (!Number.isNaN(laneY)) lanesByState.set(state, laneY);
  }
  expect(new Set(lanesByState.values()).size).toBe(lanesByState.size);
}

function expectNoFullyOverlappedWireSegments(graph: ReturnType<typeof buildAndLayout>) {
  const routedSegments = graph.edges
    .filter((edge) => !edge.from.startsWith("state:") && !edge.from.startsWith("state-not:"))
    .flatMap((edge) =>
      pointsToSegments(toPointArray(edge.points ?? [])).map((segment) => ({ ...segment, signalId: edge.from, wireId: edge.wireId ?? edge.id })),
    );

  for (let index = 0; index < routedSegments.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < routedSegments.length; otherIndex += 1) {
      const segment = routedSegments[index];
      const other = routedSegments[otherIndex];
      if (segment.signalId === other.signalId) continue;
      expect(segmentsOverlap(segment, other), `${segment.wireId} overlaps ${other.wireId}`).toBe(false);
    }
  }
}

function pointInsideBounds(point: { x: number; y: number }, bounds: { x: number; y: number; width: number; height: number }) {
  return point.x > bounds.x + 1 && point.x < bounds.x + bounds.width - 1 && point.y > bounds.y + 1 && point.y < bounds.y + bounds.height - 1;
}

function expectJunctionDotsStayOutsideComponentBodies(graph: ReturnType<typeof buildAndLayout>) {
  const bodyBounds = graph.nodes
    .filter((node) => node.type === "AND" || node.type === "OR" || node.type === "NOT" || node.type === "FF")
    .map(getNodeBounds);

  for (const dot of collectWireJunctionDots(graph)) {
    expect(bodyBounds.some((bounds) => pointInsideBounds(dot, bounds)), `dot at ${dot.x},${dot.y}`).toBe(false);
  }
}

function expectGateInputWiresReachGateBodies(graph: ReturnType<typeof buildAndLayout>) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    const targetNode = nodeById.get(edge.to);
    if (!(targetNode?.type === "AND" || targetNode?.type === "OR" || targetNode?.type === "NOT")) continue;
    expect(edge.targetAnchor?.x, edge.id).toBeGreaterThan(targetNode.x);
    expect(edge.targetAnchor?.x, edge.id).toBeLessThanOrEqual(targetNode.x + (targetNode.width ?? 0));
    expect(edge.targetAnchor?.y, edge.id).toBeGreaterThanOrEqual(targetNode.y);
    expect(edge.targetAnchor?.y, edge.id).toBeLessThanOrEqual(targetNode.y + (targetNode.height ?? 0));
  }
}

function expectComponentWireAnchorsReachBodies(graph: ReturnType<typeof buildAndLayout>) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    for (const [nodeId, anchor, role] of [
      [edge.from, edge.sourceAnchor, "source"],
      [edge.to, edge.targetAnchor, "target"],
    ] as const) {
      const node = nodeById.get(nodeId);
      if (!node) continue;
      if (!(node.type === "AND" || node.type === "OR" || node.type === "NOT" || node.type === "FF")) continue;
      expect(anchor?.x, `${edge.id} ${role} x`).toBeGreaterThanOrEqual(node.x);
      expect(anchor?.x, `${edge.id} ${role} x`).toBeLessThanOrEqual(node.x + (node.width ?? 0));
      expect(anchor?.y, `${edge.id} ${role} y`).toBeGreaterThanOrEqual(node.y);
      expect(anchor?.y, `${edge.id} ${role} y`).toBeLessThanOrEqual(node.y + (node.height ?? 0));
    }
  }
}

function expectGateOutputWiresStartInsideBodies(graph: ReturnType<typeof buildAndLayout>) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    const node = nodeById.get(edge.from);
    if (!node) continue;
    if (!(node.type === "AND" || node.type === "OR" || node.type === "NOT")) continue;
    expect(edge.sourceAnchor?.x, `${edge.id} output x`).toBeGreaterThan(node.x);
    expect(edge.sourceAnchor?.x, `${edge.id} output x`).toBeLessThan(node.x + (node.width ?? 0));
    expect(edge.sourceAnchor?.y, `${edge.id} output y`).toBeGreaterThan(node.y);
    expect(edge.sourceAnchor?.y, `${edge.id} output y`).toBeLessThan(node.y + (node.height ?? 0));
  }
}

function expectStateVariablesComeOnlyFromFlipFlops(graph: ReturnType<typeof buildAndLayout>, states: string[]) {
  for (const state of states) {
    expect(graph.nodes.some((node) => node.id === `input:${state}`), `${state} standalone input`).toBe(false);
    expect(graph.nodes.some((node) => node.id === `input:${state}'`), `${state}' standalone input`).toBe(false);
    expect(graph.edges.some((edge) => edge.from === `ff:${state}` && edge.to === `state:${state}` && edge.fromPin === "Q")).toBe(true);
    expect(graph.edges.some((edge) => edge.from === `ff:${state}` && edge.to === `state-not:${state}` && edge.fromPin === "Q'")).toBe(true);
  }
}

function expectStateGateInputsTraceToFlipFlops(graph: ReturnType<typeof buildAndLayout>) {
  for (const edge of graph.edges) {
    if (!edge.from.startsWith("state:") && !edge.from.startsWith("state-not:")) continue;
    const state = edge.from.startsWith("state-not:") ? edge.from.slice("state-not:".length) : edge.from.slice("state:".length);
    const fromPin = edge.from.startsWith("state-not:") ? "Q'" : "Q";
    expect(graph.edges.some((sourceEdge) => sourceEdge.from === `ff:${state}` && sourceEdge.to === edge.from && sourceEdge.fromPin === fromPin), edge.id).toBe(true);
  }
}

function expectFlipFlopsAreInRightColumn(graph: ReturnType<typeof buildAndLayout>) {
  const flipFlops = graph.nodes.filter((node) => node.type === "FF");
  const gates = graph.nodes.filter((node) => node.type === "AND" || node.type === "OR" || node.type === "NOT");
  expect(new Set(flipFlops.map((node) => node.x)).size).toBe(1);
  for (const gate of gates) {
    expect(gate.x, gate.id).toBeLessThan(flipFlops[0].x);
  }
}

function expectLayoutZonesAreOrdered(graph: ReturnType<typeof buildAndLayout>) {
  const flipFlops = graph.nodes.filter((node) => node.type === "FF");
  const andGates = graph.nodes.filter((node) => node.type === "AND");
  const orGates = graph.nodes.filter((node) => node.type === "OR");
  const externalNotGates = graph.nodes.filter((node) => node.type === "NOT" && node.id.startsWith("not:"));

  for (const notGate of externalNotGates) {
    for (const andGate of andGates) expect(notGate.x, `${notGate.id} before ${andGate.id}`).toBeLessThan(andGate.x);
    for (const orGate of orGates) expect(notGate.x, `${notGate.id} before ${orGate.id}`).toBeLessThan(orGate.x);
  }
  for (const andGate of andGates) {
    for (const orGate of orGates) expect(andGate.x, `${andGate.id} before ${orGate.id}`).toBeLessThan(orGate.x);
  }
  for (const gate of [...andGates, ...orGates, ...externalNotGates]) {
    for (const flipFlop of flipFlops) expect(gate.x, `${gate.id} before ${flipFlop.id}`).toBeLessThan(flipFlop.x);
  }
}

function expectStateFeedbackUsesRightBusThenSignalBus(graph: ReturnType<typeof buildAndLayout>) {
  for (const edge of graph.edges.filter((edge) => edge.from.startsWith("state:") || edge.from.startsWith("state-not:"))) {
    const state = edge.from.startsWith("state-not:") ? edge.from.slice("state-not:".length) : edge.from.slice("state:".length);
    const sourceNet = edge.from.startsWith("state-not:") ? `${state}NOT`.toUpperCase() : state.toUpperCase();
    if (edge.netId !== sourceNet) continue;
    const points = toPointArray(edge.points ?? []);
    expect(points.length, edge.id).toBeGreaterThanOrEqual(5);
    expect(points[1].x, `${edge.id} right feedback bus`).toBe(points[0].x);
    expect(points[2].y, `${edge.id} feedback lane`).toBe(points[1].y);
    expect(points[2].x, `${edge.id} returns left`).toBeLessThan(points[0].x);
  }
}

function expectClockStaysClearOfLogicGates(graph: ReturnType<typeof buildAndLayout>) {
  const clockSegments = [
    ...pointsToSegments(toPointArray(graph.clockLine.points)),
    ...graph.clockLine.branches.flatMap((branch) => pointsToSegments(toPointArray(branch))),
  ];
  const gateBounds = graph.nodes
    .filter((node) => node.type === "AND" || node.type === "OR" || node.type === "NOT")
    .map((node) => expandBounds(getNodeBounds(node), 8));

  for (const segment of clockSegments) {
    for (const bounds of gateBounds) {
      expect(segmentIntersectsBounds(segment, bounds), `CLK touches ${bounds.id}`).toBe(false);
    }
  }
}

function boundsOverlap(a: ReturnType<typeof getNodeBounds>, b: ReturnType<typeof getNodeBounds>) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function expectLogicGatesAreSeparated(graph: ReturnType<typeof buildAndLayout>) {
  const gates = graph.nodes
    .filter((node) => node.type === "AND" || node.type === "OR" || node.type === "NOT")
    .map((node) => expandBounds(getNodeBounds(node), 6));

  for (let index = 0; index < gates.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < gates.length; otherIndex += 1) {
      expect(boundsOverlap(gates[index], gates[otherIndex]), `${gates[index].id} overlaps ${gates[otherIndex].id}`).toBe(false);
    }
  }
}

describe("boolean parser", () => {
  it("parses grouped and implicit product expressions", () => {
    expect(parseBooleanEquation("(A + B)C")).toEqual({
      type: "AND",
      terms: [
        { type: "OR", terms: [{ type: "VAR", name: "A" }, { type: "VAR", name: "B" }] },
        { type: "VAR", name: "C" },
      ],
    });
    expect(parseBooleanEquation("A'B'C + AB").type).toBe("OR");
  });

  it("supports variables, complements, products, sums, and grouping", () => {
    const expressions = ["A", "A'", "B", "B'", "X", "X'", "AB", "A B", "A + B", "A'B + AB'", "(A + B)C", "A'B'C + AB"];
    for (const expression of expressions) expect(() => parseBooleanEquation(expression)).not.toThrow();
  });
});

describe("circuit graph generation", () => {
  it("builds JK flip-flop pins and gate nodes", () => {
    const graph = buildAndLayout("jk", ["A", "B", "C"], circuitFixtures[0].equations);
    expect(graph.edges.some((edge) => edge.to === "ff:A" && edge.toPin === "J")).toBe(true);
    expect(graph.edges.some((edge) => edge.to === "ff:C" && edge.toPin === "K")).toBe(true);
    expect(graph.nodes.some((node) => node.type === "OR")).toBe(true);
    expect(graph.nodes.some((node) => node.type === "AND")).toBe(true);
    expect(graph.clockLine.branches).toHaveLength(3);
  });

  it.each(circuitFixtures)("builds and routes $name flip-flop circuit diagrams", ({ flipFlopType, states, equations, expectedPins }) => {
    const graph = buildAndLayout(flipFlopType, states, equations);

    for (const state of states) {
      expect(graph.nodes.some((node) => node.id === `ff:${state}` && node.type === "FF")).toBe(true);
      for (const pin of expectedPins) expect(graph.edges.some((edge) => edge.to === `ff:${state}` && edge.toPin === pin)).toBe(true);
      expect(graph.nodes.some((node) => node.id === `state:${state}` && node.type === "STATE")).toBe(true);
      expect(graph.nodes.some((node) => node.id === `state-not:${state}` && node.type === "STATE_NOT")).toBe(true);
    }

    expect(graph.clockLine.branches).toHaveLength(states.length);
    expect(graph.metadata.validationErrors ?? []).toEqual([]);
    expectAllEdgesHaveNetIds(graph);
    expectStateOutputBusesArePinned(graph, states);
    expectAllWiresAreOrthogonal(graph);
    expectFeedbackLanesAreSeparated(graph);
    expectNoWireObstacleCollisions(graph);
    expectNoFullyOverlappedWireSegments(graph);
    expectJunctionDotsStayOutsideComponentBodies(graph);
    expectGateInputWiresReachGateBodies(graph);
    expectComponentWireAnchorsReachBodies(graph);
    expectGateOutputWiresStartInsideBodies(graph);
    expectStateVariablesComeOnlyFromFlipFlops(graph, states);
    expectStateGateInputsTraceToFlipFlops(graph);
    expectFlipFlopsAreInRightColumn(graph);
    expectLayoutZonesAreOrdered(graph);
    expectStateFeedbackUsesRightBusThenSignalBus(graph);
    expectClockStaysClearOfLogicGates(graph);
    expectLogicGatesAreSeparated(graph);
  });

  it("routes state variables as flip-flop feedback, not standalone inputs", () => {
    const graph = buildAndLayout("jk", ["A", "B"], {
      JA: "X + B",
      KA: "X' + B",
      JB: "X' + A",
      KB: "X'",
      Z: "BX + AX + AB",
    });

    expect(graph.nodes.filter((node) => node.type === "INPUT").map((node) => node.label).sort()).toEqual(["X"]);
    expect(graph.metadata.validationErrors ?? []).toEqual([]);
    expectAllEdgesHaveNetIds(graph);
    expectStateVariablesComeOnlyFromFlipFlops(graph, ["A", "B"]);
    expectStateGateInputsTraceToFlipFlops(graph);
    expectAllWiresAreOrthogonal(graph);
    expectFlipFlopsAreInRightColumn(graph);
    expectLayoutZonesAreOrdered(graph);
    expectStateFeedbackUsesRightBusThenSignalBus(graph);
    expectClockStaysClearOfLogicGates(graph);
    expectLogicGatesAreSeparated(graph);
  });

  it("exports complete SVG wires with debug attributes", () => {
    const graph = buildAndLayout("jk", ["A", "B", "C"], circuitFixtures[0].equations);
    const contentBounds = getCircuitContentBounds(graph);
    const svg = circuitGraphToSvg(graph);

    expect(svg).toContain("overflow:visible");
    expect(svg).toContain(`width="${contentBounds.width}"`);
    expect(svg).toContain(`height="${contentBounds.height}"`);
    expect(svg).toContain(`viewBox="${contentBounds.x} ${contentBounds.y} ${contentBounds.width} ${contentBounds.height}"`);
    expect(svg).toContain(">Clock</text>");
    for (const edge of graph.edges) {
      expect(edge.wireId).toBeTruthy();
      expect(svg).toContain(`data-wire-id="${edge.wireId}"`);
    }
  });
});
