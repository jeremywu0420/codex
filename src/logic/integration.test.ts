import { describe, expect, it } from "vitest";
import { buildCircuitGraph } from "./circuitGraph";
import { layoutCircuitGraph } from "./circuitLayout";
import { deriveEquations, deriveSequentialPipeline } from "./equations";
import { buildKMap } from "./kmap";
import { minimizeBoolean } from "./minimizer";
import type { FlipFlopType, StateTableRow, Variables } from "../types";

const variables: Variables = {
  inputs: ["X"],
  states: ["A"],
  outputs: ["Z"],
  clock: "CLK",
};

const rows: StateTableRow[] = [
  { id: "0-0", currentState: { A: "0" }, input: { X: "0" }, nextState: { A: "0" }, output: { Z: "0" } },
  { id: "0-1", currentState: { A: "0" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "1" } },
  { id: "1-0", currentState: { A: "1" }, input: { X: "0" }, nextState: { A: "0" }, output: { Z: "0" } },
  { id: "1-1", currentState: { A: "1" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "1" } },
];

describe("logic integration", () => {
  it("derives Mealy outputs from state and input variables", () => {
    const equations = deriveEquations(rows, variables, "mealy", "d");
    expect(equations.find((equation) => equation.label === "Z")?.variableNames).toEqual(["A", "X"]);
  });

  it("derives next-state equations before excitation equations", () => {
    const pipeline = deriveSequentialPipeline(rows, variables, "mealy", "jk");

    expect(pipeline.nextStateEquations.map((equation) => equation.label)).toEqual(["A+"]);
    expect(pipeline.excitationEquations.map((equation) => equation.label)).toEqual(["J_A", "K_A"]);
    expect(pipeline.outputEquations.map((equation) => equation.label)).toEqual(["Z"]);
    expect(pipeline.circuitEquations.map((equation) => equation.label)).toEqual(["J_A", "K_A", "Z"]);
  });

  it("derives Moore outputs from state variables only", () => {
    const equations = deriveEquations(rows, variables, "moore", "d");
    expect(equations.find((equation) => equation.label === "Z")?.variableNames).toEqual(["A"]);
  });

  it("uses one output value per present state for Moore equations", () => {
    const conflictingRows: StateTableRow[] = [
      { id: "0-0", currentState: { A: "0" }, input: { X: "0" }, nextState: { A: "0" }, output: { Z: "0" } },
      { id: "0-1", currentState: { A: "0" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "1" } },
      { id: "1-0", currentState: { A: "1" }, input: { X: "0" }, nextState: { A: "0" }, output: { Z: "1" } },
      { id: "1-1", currentState: { A: "1" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "0" } },
    ];
    const equation = deriveEquations(conflictingRows, variables, "moore", "d").find((item) => item.label === "Z");
    expect(equation?.minterms).toEqual([1]);
  });

  it("keeps table don't-care values in derived equations", () => {
    const rowsWithDontCares: StateTableRow[] = [
      { id: "0-0", currentState: { A: "0" }, input: { X: "0" }, nextState: { A: "-" }, output: { Z: "-" } },
      { id: "0-1", currentState: { A: "0" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "1" } },
      { id: "1-0", currentState: { A: "1" }, input: { X: "0" }, nextState: { A: "0" }, output: { Z: "0" } },
      { id: "1-1", currentState: { A: "1" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "1" } },
    ];
    const equations = deriveEquations(rowsWithDontCares, variables, "mealy", "d");
    expect(equations.find((equation) => equation.label === "D_A")?.dontCares).toContain(0);
    expect(equations.find((equation) => equation.label === "Z")?.dontCares).toContain(0);
  });

  it("minimizes known truth tables", () => {
    expect(minimizeBoolean("F", ["A", "B"], [1, 3], []).expression).toBe("B");
  });

  it("builds K-map cells with dont care values", () => {
    const map = buildKMap(minimizeBoolean("F", ["A", "B"], [1], [3]));
    expect(map.cells.find((cell) => cell.minterm === 3)?.value).toBe("-");
  });

  it("builds K-map cells for more than four variables", () => {
    const map = buildKMap(minimizeBoolean("F", ["A", "B", "C", "X", "Y"], [0, 3, 17], []));
    expect(map.cells).toHaveLength(32);
    expect(new Set(map.cells.map((cell) => cell.minterm)).size).toBe(32);
  });

  it("draws a clock source, clock bus, and clock pin wires", () => {
    const equations = deriveEquations(rows, variables, "mealy", "d");
    const graph = buildCircuitGraph({ equations, flipFlopType: "d", variables });
    expect(graph.nodes.some((node) => node.id === "ff:A")).toBe(true);
    expect(graph.clockLine.label).toBe("CLK");
    expect(graph.edges.some((edge) => edge.to === "ff:A" && edge.toPin === "D")).toBe(true);
  });

  it.each<FlipFlopType>(["jk", "t", "sr", "d"])("keeps the full derivation pipeline connected for %s flip-flops", (flipFlopType) => {
    const equations = deriveEquations(rows, variables, "mealy", flipFlopType);
    const maps = equations.map(buildKMap);
    const graph = buildCircuitGraph({ equations, flipFlopType, variables });

    expect(equations.some((equation) => equation.label === "Z")).toBe(true);
    expect(maps).toHaveLength(equations.length);
    expect(graph.metadata.flipFlopType).toBe(flipFlopType);
    expect(graph.edges.some((edge) => edge.to === "ff:A")).toBe(true);
  });

  it("lays out the two-state JK machine whose shared XOR product terms previously merged nets", () => {
    // Regression: this exact Mealy/JK state table derives J_A = K_A = B'X + BX' and
    // Z = A'X + B'X + ABX'. The shared product terms B'X and BX' fan out from single
    // AND gates into different OR gates, which used to route onto the same vertical
    // lane and fail validation ("Different nets NET_AND_B_NOT_X and NET_AND_NOT_B_X
    // share wire segment ...").
    const twoStateVariables: Variables = { inputs: ["X"], states: ["A", "B"], outputs: ["Z"], clock: "CLK" };
    const twoStateRows: StateTableRow[] = [
      { id: "000", currentState: { A: "0", B: "0" }, input: { X: "0" }, nextState: { A: "0", B: "1" }, output: { Z: "0" } },
      { id: "001", currentState: { A: "0", B: "0" }, input: { X: "1" }, nextState: { A: "1", B: "1" }, output: { Z: "1" } },
      { id: "010", currentState: { A: "0", B: "1" }, input: { X: "0" }, nextState: { A: "1", B: "0" }, output: { Z: "0" } },
      { id: "011", currentState: { A: "0", B: "1" }, input: { X: "1" }, nextState: { A: "0", B: "0" }, output: { Z: "1" } },
      { id: "100", currentState: { A: "1", B: "0" }, input: { X: "0" }, nextState: { A: "1", B: "1" }, output: { Z: "0" } },
      { id: "101", currentState: { A: "1", B: "0" }, input: { X: "1" }, nextState: { A: "0", B: "1" }, output: { Z: "1" } },
      { id: "110", currentState: { A: "1", B: "1" }, input: { X: "0" }, nextState: { A: "0", B: "0" }, output: { Z: "1" } },
      { id: "111", currentState: { A: "1", B: "1" }, input: { X: "1" }, nextState: { A: "1", B: "0" }, output: { Z: "0" } },
    ];

    const pipeline = deriveSequentialPipeline(twoStateRows, twoStateVariables, "mealy", "jk");
    const graph = layoutCircuitGraph(
      buildCircuitGraph({ equations: pipeline.circuitEquations, flipFlopType: "jk", variables: twoStateVariables }),
    );

    expect(graph.metadata.validationErrors ?? []).toEqual([]);
  });
});
