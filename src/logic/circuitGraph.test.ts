import { describe, expect, it } from "vitest";
import { parseBooleanEquation } from "./booleanParser";
import { buildCircuitGraph } from "./circuitGraph";
import {
  circuitGraphToSvg,
  collectWireJunctionDots,
  expandBounds,
  getNodeBounds,
  layoutCircuitGraph,
  pathIntersectsObstacles,
  pointsToSegments,
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

function expectStateOutputBusesArePinned(graph: ReturnType<typeof buildAndLayout>, states: string[]) {
  for (const state of states) {
    const qEdge = graph.edges.find((edge) => edge.from === `ff:${state}` && edge.to === `state:${state}`);
    const qBarEdge = graph.edges.find((edge) => edge.from === `ff:${state}` && edge.to === `state-not:${state}`);
    expect(qEdge?.sourceAnchor?.y, `Q bus ${state}`).toBe(qEdge?.targetAnchor?.y);
    expect(qBarEdge?.sourceAnchor?.y, `Qbar bus ${state}`).toBe(qBarEdge?.targetAnchor?.y);
    expect(qBarEdge?.sourceAnchor?.x, `Qbar source ${state}`).toBeLessThan(qBarEdge?.targetAnchor?.x ?? 0);
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
  const routedSegments = graph.edges.flatMap((edge) =>
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
    expectStateOutputBusesArePinned(graph, states);
    expectFeedbackLanesAreSeparated(graph);
    expectNoWireObstacleCollisions(graph);
    expectNoFullyOverlappedWireSegments(graph);
    expectJunctionDotsStayOutsideComponentBodies(graph);
    expectGateInputWiresReachGateBodies(graph);
    expectComponentWireAnchorsReachBodies(graph);
    expectGateOutputWiresStartInsideBodies(graph);
  });

  it("exports complete SVG wires with debug attributes", () => {
    const graph = buildAndLayout("jk", ["A", "B", "C"], circuitFixtures[0].equations);
    const svg = circuitGraphToSvg(graph);

    expect(svg).toContain("overflow:visible");
    expect(svg).toContain(">Clock</text>");
    for (const edge of graph.edges) {
      expect(edge.wireId).toBeTruthy();
      expect(svg).toContain(`data-wire-id="${edge.wireId}"`);
    }
  });
});
