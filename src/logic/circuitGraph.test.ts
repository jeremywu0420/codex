import { describe, expect, it } from "vitest";
import { parseBooleanEquation } from "./booleanParser";
import { buildCircuitGraph } from "./circuitGraph";
import { deriveSequentialPipeline } from "./equations";
import {
  circuitGraphToSvg,
  collectWireJunctionDots,
  detectJunctions,
  expandBounds,
  getCircuitContentBounds,
  getNodeBounds,
  getNodePins,
  layoutCircuitGraph,
  pathIntersectsObstacles,
  pointsToSegments,
  segmentIntersectsBounds,
  segmentsOverlap,
} from "./circuitLayout";
import type { CircuitGraph, FlipFlopType, StateTableRow, Variables } from "../types";

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

function stateTableRow(id: string, currentState: string, input: string, nextState: string, output: string): StateTableRow {
  return {
    id,
    currentState: { A: currentState[0] as "0" | "1", B: currentState[1] as "0" | "1" },
    input: { X: input as "0" | "1" },
    nextState: { A: nextState[0] as "0" | "1", B: nextState[1] as "0" | "1" },
    output: { Z: output as "0" | "1" },
  };
}

function graphWithEdges(edges: CircuitGraph["edges"]): CircuitGraph {
  return {
    nodes: [],
    edges,
    clockLine: { label: "Clock", points: [], branches: [] },
    metadata: {
      width: 120,
      height: 80,
      flipFlopType: "d",
      stateVariables: [],
      inputVariables: [],
      outputVariables: [],
    },
  };
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

function pathLength(points: { x: number; y: number }[]) {
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    length += Math.abs(points[index + 1].x - points[index].x) + Math.abs(points[index + 1].y - points[index].y);
  }
  return length;
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
    if (qEdge) expect(qEdge.sourceAnchor?.y, `Q bus ${state}`).toBe(qEdge.targetAnchor?.y);
    if (qBarEdge) {
      expect(qBarEdge.sourceAnchor?.y, `Qbar bus ${state}`).toBe(qBarEdge.targetAnchor?.y);
      expect(qBarEdge.sourceAnchor?.x, `Qbar source ${state}`).toBeLessThan(qBarEdge.targetAnchor?.x ?? 0);
    }
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

function expectGateOutputWiresStartAtOutputPins(graph: ReturnType<typeof buildAndLayout>) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    const node = nodeById.get(edge.from);
    if (!node) continue;
    if (!(node.type === "AND" || node.type === "OR" || node.type === "NOT")) continue;
    const outputPin = getNodePins(node).outputPin;
    const points = toPointArray(edge.points ?? []);
    expect(outputPin, `${edge.id} output pin`).toBeTruthy();
    expect(edge.sourceAnchor, `${edge.id} source anchor`).toEqual(outputPin);
    expect(points[0], `${edge.id} first wire point`).toEqual(outputPin);
    expect(edge.sourceAnchor?.x, `${edge.id} output x`).toBe(node.x + (node.width ?? 0));
    expect(edge.sourceAnchor?.y, `${edge.id} output y`).toBe(node.y + (node.height ?? 0) / 2);
    if (points.length > 2) {
      expect(points[1].y, `${edge.id} output exit y`).toBe(points[0].y);
      expect(points[1].x, `${edge.id} output exit x`).toBeGreaterThan(points[0].x);
    }
  }
}

function expectGateToFlipFlopRoutesAreShortAndDirect(graph: ReturnType<typeof buildAndLayout>) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if (!(fromNode?.type === "AND" || fromNode?.type === "OR")) continue;
    if (toNode?.type !== "FF") continue;
    const points = toPointArray(edge.points ?? []);
    const minimumLength = Math.abs((edge.targetAnchor?.x ?? 0) - (edge.sourceAnchor?.x ?? 0)) + Math.abs((edge.targetAnchor?.y ?? 0) - (edge.sourceAnchor?.y ?? 0));
    expect(pathLength(points), edge.id).toBeLessThanOrEqual(minimumLength + 48);
    expect(points.length, edge.id).toBeLessThanOrEqual(5);
  }
}

function expectStateVariablesComeOnlyFromFlipFlops(graph: ReturnType<typeof buildAndLayout>, states: string[]) {
  for (const state of states) {
    expect(graph.nodes.some((node) => node.id === `input:${state}`), `${state} standalone input`).toBe(false);
    expect(graph.nodes.some((node) => node.id === `input:${state}'`), `${state}' standalone input`).toBe(false);
    if (graph.edges.some((edge) => edge.from === `state:${state}`)) {
      expect(graph.edges.some((edge) => edge.from === `ff:${state}` && edge.to === `state:${state}` && edge.fromPin === "Q")).toBe(true);
    }
    if (graph.edges.some((edge) => edge.from === `state-not:${state}`)) {
      expect(graph.edges.some((edge) => edge.from === `ff:${state}` && edge.to === `state-not:${state}` && edge.fromPin === "Q'")).toBe(true);
    }
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
    expect(points[1].x, `${edge.id} right feedback exit`).toBeGreaterThan(points[0].x);
    expect(points[2].x, `${edge.id} right feedback bus`).toBe(points[1].x);
    expect(points[3].y, `${edge.id} feedback lane`).toBe(points[2].y);
    expect(points[3].x, `${edge.id} returns left`).toBeLessThan(points[0].x);
  }
}

function expectStateSignalsShareOneFeedbackTrunk(graph: ReturnType<typeof buildAndLayout>) {
  const trunkBySource = new Map<string, { exitX: number; laneX: number; laneY: number }>();
  for (const edge of graph.edges.filter((edge) => (edge.from.startsWith("state:") || edge.from.startsWith("state-not:")) && edge.to.startsWith("gate:"))) {
    const points = toPointArray(edge.points ?? []);
    if (points.length < 4) continue;
    const trunk = {
      exitX: points[1].x,
      laneX: points[2].x,
      laneY: points[2].y,
    };
    const previous = trunkBySource.get(edge.from);
    if (!previous) {
      trunkBySource.set(edge.from, trunk);
      continue;
    }
    expect(trunk, edge.id).toEqual(previous);
  }
}

function expectOutputsStayRightOfLogicAndLeftOfFeedback(graph: ReturnType<typeof buildAndLayout>) {
  const flipFlopX = Math.min(...graph.nodes.filter((node) => node.type === "FF").map((node) => node.x));
  const gateRight = Math.max(
    ...graph.nodes
      .filter((node) => node.type === "AND" || node.type === "OR" || node.type === "NOT")
      .map((node) => node.x + (node.width ?? 0)),
  );
  for (const output of graph.nodes.filter((node) => node.type === "OUTPUT")) {
    expect(output.x, output.id).toBeGreaterThan(gateRight);
    expect(output.x, output.id).toBeLessThan(flipFlopX);
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
    const expressions = [
      "A",
      "A'",
      "!A",
      "NOT(A)",
      "B",
      "B'",
      "X",
      "X'",
      "AB",
      "A B",
      "A' · X",
      "A + B",
      "A'B + AB'",
      "(A + B)C",
      "A'B'C + AB",
    ];
    for (const expression of expressions) expect(() => parseBooleanEquation(expression)).not.toThrow();
  });
});

describe("circuit graph generation", () => {
  it("draws a junction dot where a same-net branch leaves a trunk", () => {
    const graph = graphWithEdges([
      { id: "trunk", from: "source", to: "sink-a", netId: "N", wireId: "N_trunk", points: [0, 0, 100, 0] },
      { id: "branch", from: "source", to: "sink-b", netId: "N", wireId: "N_branch", points: [50, 0, 50, 50] },
    ]);

    expect(collectWireJunctionDots(graph)).toEqual(expect.arrayContaining([expect.objectContaining({ x: 50, y: 0 })]));
  });

  it("does not draw a junction dot for visual crossings between different nets", () => {
    const graph = graphWithEdges([
      { id: "horizontal", from: "a", to: "b", netId: "A", wireId: "A_wire", points: [0, 0, 100, 0] },
      { id: "vertical", from: "c", to: "d", netId: "B", wireId: "B_wire", points: [50, -30, 50, 30] },
    ]);

    expect(collectWireJunctionDots(graph).some((dot) => dot.x === 50 && dot.y === 0)).toBe(false);
  });

  it("keeps simple same-net bends from being treated as junctions", () => {
    const dots = detectJunctions([
      { netId: "N", wireId: "N_wire", from: { x: 0, y: 0 }, to: { x: 50, y: 0 } },
      { netId: "N", wireId: "N_wire", from: { x: 50, y: 0 }, to: { x: 50, y: 50 } },
    ]);

    expect(dots.some((dot) => dot.x === 50 && dot.y === 0)).toBe(false);
  });

  it("does not draw a junction dot where a same-net straight wire is split into collinear segments", () => {
    const dots = detectJunctions([
      { netId: "N", wireId: "N_left", from: { x: 0, y: 0 }, to: { x: 50, y: 0 } },
      { netId: "N", wireId: "N_right", from: { x: 50, y: 0 }, to: { x: 100, y: 0 } },
    ]);

    expect(dots.some((dot) => dot.x === 50 && dot.y === 0)).toBe(false);
  });

  it("does not draw a junction dot on the middle of a single straight wire", () => {
    const dots = detectJunctions([
      { netId: "N", wireId: "N_wire", from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
    ]);

    expect(dots).toEqual([]);
  });

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
    expectGateOutputWiresStartAtOutputPins(graph);
    expectStateVariablesComeOnlyFromFlipFlops(graph, states);
    expectStateGateInputsTraceToFlipFlops(graph);
    expectFlipFlopsAreInRightColumn(graph);
    expectLayoutZonesAreOrdered(graph);
    expectStateFeedbackUsesRightBusThenSignalBus(graph);
    expectStateSignalsShareOneFeedbackTrunk(graph);
    expectClockStaysClearOfLogicGates(graph);
    expectLogicGatesAreSeparated(graph);
    expectGateToFlipFlopRoutesAreShortAndDirect(graph);
    expectOutputsStayRightOfLogicAndLeftOfFeedback(graph);
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
    expectStateSignalsShareOneFeedbackTrunk(graph);
    expectClockStaysClearOfLogicGates(graph);
    expectLogicGatesAreSeparated(graph);
    expectGateToFlipFlopRoutesAreShortAndDirect(graph);
    expectOutputsStayRightOfLogicAndLeftOfFeedback(graph);
  });

  it("generates D flip-flop circuits from current equations without JK pins or net overlaps", () => {
    const graph = buildAndLayout("d", ["A", "B"], {
      D_A: "A'B + B'X",
      D_B: "B'X' + BX + AX",
      Z: "BX + AX + AB",
    });

    expect(graph.metadata.validationErrors ?? []).toEqual([]);
    expect(graph.edges.some((edge) => edge.to === "ff:A" && edge.toPin === "D" && edge.netId === "DA")).toBe(true);
    expect(graph.edges.some((edge) => edge.to === "ff:B" && edge.toPin === "D" && edge.netId === "DB")).toBe(true);
    expect(graph.edges.some((edge) => edge.toPin === "J" || edge.toPin === "K")).toBe(false);
    expect(graph.nodes.filter((node) => node.type === "FF").every((node) => node.flipFlopType === "d")).toBe(true);

    for (const nodeId of ["state:A", "state-not:A", "state:B", "state-not:B"]) {
      const node = graph.nodes.find((candidate) => candidate.id === nodeId);
      expect(node, nodeId).toBeTruthy();
      expect(typeof node?.metadata?.busX, nodeId).toBe("number");
      expect(typeof node?.metadata?.feedbackLaneY, nodeId).toBe("number");
      expect(node?.metadata?.labelX, `${nodeId} hidden label x`).toBeUndefined();
      expect(node?.metadata?.labelY, `${nodeId} hidden label y`).toBeUndefined();
    }

    expectAllEdgesHaveNetIds(graph);
    expectAllWiresAreOrthogonal(graph);
    expectNoWireObstacleCollisions(graph);
    expectNoFullyOverlappedWireSegments(graph);
    expectGateInputWiresReachGateBodies(graph);
    expectStateVariablesComeOnlyFromFlipFlops(graph, ["A", "B"]);
    expectStateGateInputsTraceToFlipFlops(graph);
    expectStateSignalsShareOneFeedbackTrunk(graph);
    expectGateToFlipFlopRoutesAreShortAndDirect(graph);
    expectOutputsStayRightOfLogicAndLeftOfFeedback(graph);
  });

  it("generates T flip-flop circuits when X' directly feeds an OR gate", () => {
    const graph = buildAndLayout("t", ["A", "B"], {
      T_A: "A'X + B + AX'",
      T_B: "X' + AB'",
      Z: "BX + AX + AB",
    });

    expect(graph.metadata.validationErrors ?? []).toEqual([]);
    expect(graph.edges.some((edge) => edge.to === "ff:A" && edge.toPin === "T" && edge.netId === "TA")).toBe(true);
    expect(graph.edges.some((edge) => edge.to === "ff:B" && edge.toPin === "T" && edge.netId === "TB")).toBe(true);
    expect(graph.edges.some((edge) => edge.wireId === "XNOT_not_X_out_to_gate_or_3_in0")).toBe(true);
    expect(graph.nodes.filter((node) => node.type === "STATE" || node.type === "STATE_NOT").every((node) => node.metadata?.labelX === undefined && node.metadata?.labelY === undefined)).toBe(true);
    expectAllWiresAreOrthogonal(graph);
    expectNoWireObstacleCollisions(graph);
    expectNoFullyOverlappedWireSegments(graph);
    expectStateSignalsShareOneFeedbackTrunk(graph);
    expectGateToFlipFlopRoutesAreShortAndDirect(graph);
    expectOutputsStayRightOfLogicAndLeftOfFeedback(graph);
  });

  it("does not draw flip-flop output wires for unused Q or Q' ports", () => {
    const graph = buildAndLayout("jk", ["A", "B"], {
      J_A: "X + B",
      K_A: "X + B",
      J_B: "X",
      K_B: "X",
      Z: "X",
    });

    expect(graph.metadata.validationErrors ?? []).toEqual([]);
    expect(graph.edges.some((edge) => edge.from === "ff:A" && edge.to === "state:A" && edge.fromPin === "Q")).toBe(false);
    expect(graph.edges.some((edge) => edge.from === "ff:A" && edge.to === "state-not:A" && edge.fromPin === "Q'")).toBe(false);
    expect(graph.edges.some((edge) => edge.from === "ff:B" && edge.to === "state:B" && edge.fromPin === "Q")).toBe(true);
    expect(graph.edges.some((edge) => edge.from === "ff:B" && edge.to === "state-not:B" && edge.fromPin === "Q'")).toBe(false);
  });

  it("fans out shared JK flip-flop input expressions without net conflicts", () => {
    const graph = buildAndLayout("jk", ["A", "B"], {
      J_A: "B",
      K_A: "X'",
      J_B: "A'X + AX'",
      K_B: "X'",
      Z: "A'BX' + AB' + AX",
    });
    const kEdges = graph.edges.filter((edge) => edge.to.startsWith("ff:") && edge.toPin === "K");

    expect(graph.metadata.validationErrors ?? []).toEqual([]);
    expect(kEdges).toHaveLength(2);
    expect(new Set(kEdges.map((edge) => edge.netId))).toEqual(new Set(["XNOT"]));
  });

  it("reroutes shared product terms feeding different OR gates onto independent segments", () => {
    const graph = buildAndLayout("jk", ["A", "B"], {
      J_A: "BX' + B'X + A + A'B",
      K_A: "BX' + B'X + A'X + X'",
      J_B: "BX' + B'X + AB' + AB",
      K_B: "BX' + B'X + AX + B'",
      Z: "AB + A'B'",
    });

    const sharedSegmentErrors = (graph.metadata.validationErrors ?? []).filter((error) =>
      error.includes("share wire segment"),
    );
    expect(sharedSegmentErrors).toEqual([]);
    expect(graph.metadata.validationErrors ?? []).toEqual([]);
    expectNoFullyOverlappedWireSegments(graph);
    expectAllWiresAreOrthogonal(graph);
    expectNoWireObstacleCollisions(graph);
  });

  it("routes derived JK product-term nets without sharing deterministic wire segments", () => {
    const derivedVariables = variables(["A", "B"]);
    const rows = [
      stateTableRow("00-0", "00", "0", "01", "0"),
      stateTableRow("00-1", "00", "1", "11", "1"),
      stateTableRow("01-0", "01", "0", "10", "0"),
      stateTableRow("01-1", "01", "1", "00", "1"),
      stateTableRow("10-0", "10", "0", "11", "0"),
      stateTableRow("10-1", "10", "1", "01", "1"),
      stateTableRow("11-0", "11", "0", "00", "1"),
      stateTableRow("11-1", "11", "1", "10", "0"),
    ];
    const pipeline = deriveSequentialPipeline(rows, derivedVariables, "mealy", "jk");
    const equations = Object.fromEntries(pipeline.circuitEquations.map((equation) => [equation.label, equation.expression])) as Record<string, string>;
    const graph = layoutCircuitGraph(buildCircuitGraph({ equations, flipFlopType: "jk", variables: derivedVariables }));

    expect(equations.J_B).toBe("1");
    expect(equations.K_B).toBe("1");
    expect(graph.metadata.validationErrors ?? []).toEqual([]);
    expectNoWireObstacleCollisions(graph);
    expectNoFullyOverlappedWireSegments(graph);
    expectAllWiresAreOrthogonal(graph);
  });

  it("fans out shared D flip-flop input expressions without net conflicts", () => {
    const graph = buildAndLayout("d", ["A", "B"], {
      D_A: "X'",
      D_B: "X'",
      Z: "A + B",
    });
    const dEdges = graph.edges.filter((edge) => edge.to.startsWith("ff:") && edge.toPin === "D");

    expect(graph.metadata.validationErrors ?? []).toEqual([]);
    expect(dEdges).toHaveLength(2);
    expect(new Set(dEdges.map((edge) => edge.netId))).toEqual(new Set(["XNOT"]));
  });

  it("fans out shared T flip-flop input expressions without net conflicts", () => {
    const graph = buildAndLayout("t", ["A", "B"], {
      T_A: "A'X",
      T_B: "X A'",
      Z: "AX + B",
    });
    const tEdges = graph.edges.filter((edge) => edge.to.startsWith("ff:") && edge.toPin === "T");

    expect(graph.metadata.validationErrors ?? []).toEqual([]);
    expect(tEdges).toHaveLength(2);
    expect(new Set(tEdges.map((edge) => edge.netId)).size).toBe(1);
  });

  it("fans out shared SR flip-flop input expressions without net conflicts", () => {
    const graph = buildAndLayout("sr", ["A", "B"], {
      S_A: "X + B",
      S_B: "B + X",
      R_A: "X'",
      R_B: "!X",
      Z: "AB",
    });
    const sEdges = graph.edges.filter((edge) => edge.to.startsWith("ff:") && edge.toPin === "S");
    const rEdges = graph.edges.filter((edge) => edge.to.startsWith("ff:") && edge.toPin === "R");

    expect(graph.metadata.validationErrors ?? []).toEqual([]);
    expect(sEdges).toHaveLength(2);
    expect(rEdges).toHaveLength(2);
    expect(new Set(sEdges.map((edge) => edge.netId)).size).toBe(1);
    expect(new Set(rEdges.map((edge) => edge.netId))).toEqual(new Set(["XNOT"]));
  });

  it("routes constant JK flip-flop inputs as local pin stubs", () => {
    const graph = buildAndLayout("jk", ["A", "B"], {
      J_A: "X",
      K_A: "X",
      J_B: "1",
      K_B: "1",
      Z: "X",
    });
    const jEdge = graph.edges.find((edge) => edge.label === "J_B");
    const kEdge = graph.edges.find((edge) => edge.label === "K_B");

    expect(graph.metadata.validationErrors ?? []).toEqual([]);
    expect(jEdge).toBeTruthy();
    expect(kEdge).toBeTruthy();
    expect(jEdge?.from).toBe("const:J_B");
    expect(kEdge?.from).toBe("const:K_B");
    expect(jEdge?.metadata?.constantValue).toBe("1");
    expect(kEdge?.metadata?.constantValue).toBe("1");
    expect(jEdge?.metadata?.pinValue).toBe("1");
    expect(kEdge?.metadata?.pinValue).toBe("1");

    for (const edge of [jEdge!, kEdge!]) {
      const points = toPointArray(edge.points ?? []);
      expect(points).toHaveLength(2);
      expect(points[0]).toEqual(edge.sourceAnchor);
      expect(points[1]).toEqual(edge.targetAnchor);
      expect(edge.sourceAnchor?.y).toBe(edge.targetAnchor?.y);
      expect(edge.sourceAnchor?.x).toBe((edge.targetAnchor?.x ?? 0) - 34);
      expect(edge.netId).toMatch(/^CONST_1_/);
    }

    expect(graph.nodes.find((node) => node.id === "const:J_B")).toMatchObject({
      label: "1",
      metadata: expect.objectContaining({ constantValue: "1", pinValue: "1" }),
    });
    expect(graph.nodes.find((node) => node.id === "const:K_B")).toMatchObject({
      label: "1",
      metadata: expect.objectContaining({ constantValue: "1", pinValue: "1" }),
    });
  });

  it("routes constant-zero flip-flop inputs as local pin stubs", () => {
    const graph = buildAndLayout("jk", ["A", "B"], {
      J_A: "X",
      K_A: "X",
      J_B: "0",
      K_B: "0",
      Z: "X",
    });
    const constantEdges = graph.edges.filter((edge) => edge.to === "ff:B" && (edge.toPin === "J" || edge.toPin === "K"));

    expect(graph.metadata.validationErrors ?? []).toEqual([]);
    expect(constantEdges).toHaveLength(2);
    for (const edge of constantEdges) {
      const points = toPointArray(edge.points ?? []);
      expect(edge.from).toMatch(/^const:/);
      expect(edge.metadata?.constantValue).toBe("0");
      expect(edge.metadata?.pinValue).toBe("0");
      expect(points).toHaveLength(2);
      expect(edge.sourceAnchor?.x).toBe((edge.targetAnchor?.x ?? 0) - 34);
      expect(edge.sourceAnchor?.y).toBe(edge.targetAnchor?.y);
      expect(edge.netId).toMatch(/^CONST_0_/);
    }
  });

  it("fans out shared complements across three D flip-flop inputs", () => {
    const graph = buildAndLayout("d", ["A", "B", "C"], {
      D_A: "X'",
      D_B: "!X",
      D_C: "NOT(X)",
      Z: "A + B + C",
    });
    const dEdges = graph.edges.filter((edge) => edge.to.startsWith("ff:") && edge.toPin === "D");

    expect(graph.metadata.validationErrors ?? []).toEqual([]);
    expect(dEdges).toHaveLength(3);
    expect(new Set(dEdges.map((edge) => edge.netId))).toEqual(new Set(["XNOT"]));
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
    expect(svg.indexOf('class="junction-dot"')).toBeGreaterThan(-1);
    expect(svg.indexOf('class="junction-dot"')).toBeLessThan(svg.indexOf("<text"));
    for (const edge of graph.edges) {
      expect(edge.wireId).toBeTruthy();
      expect(svg).toContain(`data-wire-id="${edge.wireId}"`);
    }
  });
});
