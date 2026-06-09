import { describe, expect, it } from "vitest";
import type { CircuitGraph, StateTableRow, Variables } from "../types";
import { encodingToContext, evaluateBooleanExpression, normalizeEquation, verifyAllResults } from "./verification";

const variables: Variables = {
  inputs: ["X"],
  states: ["A"],
  outputs: ["Z"],
  clock: "CLK",
};

const dRows: StateTableRow[] = [
  { id: "0-0", currentState: { A: "0" }, input: { X: "0" }, nextState: { A: "0" }, output: { Z: "0" } },
  { id: "0-1", currentState: { A: "0" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "1" } },
  { id: "1-0", currentState: { A: "1" }, input: { X: "0" }, nextState: { A: "0" }, output: { Z: "0" } },
  { id: "1-1", currentState: { A: "1" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "1" } },
];

const toggleRows: StateTableRow[] = [
  { id: "0-0", currentState: { A: "0" }, input: { X: "0" }, nextState: { A: "0" }, output: { Z: "0" } },
  { id: "0-1", currentState: { A: "0" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "1" } },
  { id: "1-0", currentState: { A: "1" }, input: { X: "0" }, nextState: { A: "1" }, output: { Z: "0" } },
  { id: "1-1", currentState: { A: "1" }, input: { X: "1" }, nextState: { A: "0" }, output: { Z: "1" } },
];

describe("boolean verification helpers", () => {
  it("evaluates common boolean expression syntax", () => {
    expect(evaluateBooleanExpression("A'B + x", { A: "0", B: "1", x: "0" })).toBe("1");
    expect(evaluateBooleanExpression("(A + B')x", { A: "0", B: "0", x: "1" })).toBe("1");
    expect(evaluateBooleanExpression("Q1'Q0 + X", { Q1: "0", Q0: "0", X: "1" })).toBe("1");
    expect(evaluateBooleanExpression("A B + xC'", { A: "1", B: "1", x: "0", C: "1" })).toBe("1");
    expect(evaluateBooleanExpression("A\u7e5aB", { A: "1", B: "1" })).toBe("1");
    expect(evaluateBooleanExpression("~A", { A: "0" })).toBe("1");
    expect(evaluateBooleanExpression("1", {})).toBe("1");
    expect(evaluateBooleanExpression("0", {})).toBe("0");
  });

  it("maps state encoding bits to the supplied labels from MSB to LSB", () => {
    expect(encodingToContext("S2", { S0: "00", S1: "01", S2: "10" }, ["Q1", "Q0"])).toEqual({
      Q1: "1",
      Q0: "0",
    });
  });

  it("normalizes term-list and Equation-object inputs", () => {
    expect(normalizeEquation("F", [["A'", "B"], ["x"]]).expression).toBe("A'B + x");
    expect(normalizeEquation("F", ["A'B", "x"]).expression).toBe("A'B + x");
    expect(
      normalizeEquation("fallback", {
        id: "Z",
        label: "Z",
        variableNames: ["A", "X"],
        minterms: [1],
        dontCares: [],
        expression: "A + X",
      }).label,
    ).toBe("Z");
  });
});

describe("verifyAllResults", () => {
  it("passes a D flip-flop derivation and skips unavailable timing and circuit results", () => {
    const result = verifyAllResults({
      stateTable: dRows,
      modelType: "mealy",
      flipFlopType: "d",
      variables,
      nextStateEquations: { "A+": "X" },
      excitationEquations: { D_A: "X" },
      outputEquations: { Z: "X" },
    });

    expect(result.passed).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(result.checks.find((check) => check.name === "State transition check")).toMatchObject({
      skipped: true,
      passed: false,
    });
    expect(result.checks.find((check) => check.name === "Timing trace check")?.skipped).toBe(true);
    expect(result.checks.find((check) => check.name === "Circuit graph check")?.skipped).toBe(true);
  });

  it("uses excitation equations before next-state equations", () => {
    const result = verifyAllResults({
      stateTable: dRows,
      modelType: "mealy",
      flipFlopType: "d",
      variables,
      nextStateEquations: { "A+": "0" },
      excitationEquations: { D_A: "X" },
      outputEquations: { Z: "X" },
    });

    expect(result.passed).toBe(true);
    expect(result.mismatches.some((mismatch) => mismatch.type === "NEXT_STATE")).toBe(false);
    expect(result.checks.find((check) => check.name === "State transition check")?.skipped).toBe(true);
    expect(result.checks.find((check) => check.name === "Flip-flop excitation check")?.passed).toBe(true);
  });

  it("does not treat circuit equations as missing next-state equations", () => {
    const result = verifyAllResults({
      stateTable: dRows,
      modelType: "mealy",
      flipFlopType: "d",
      variables,
      equations: { D_A: "X", Z: "X" },
    });

    expect(result.passed).toBe(true);
    expect(result.checks.find((check) => check.name === "State transition check")?.skipped).toBe(true);
  });

  it("passes T flip-flop excitation when T toggles on X", () => {
    const result = verifyAllResults({
      stateTable: toggleRows,
      modelType: "mealy",
      flipFlopType: "t",
      variables,
      excitationEquations: { T_A: "X" },
      outputEquations: { Z: "X" },
    });

    expect(result.passed).toBe(true);
  });

  it("passes JK flip-flop excitation when J and K toggle on X", () => {
    const result = verifyAllResults({
      stateTable: toggleRows,
      modelType: "mealy",
      flipFlopType: "jk",
      variables,
      excitationEquations: { J_A: "X", K_A: "X" },
      outputEquations: { Z: "X" },
    });

    expect(result.passed).toBe(true);
  });

  it("fails invalid SR excitation inputs", () => {
    const result = verifyAllResults({
      stateTable: dRows.slice(0, 1),
      modelType: "mealy",
      flipFlopType: "sr",
      variables,
      excitationEquations: { S_A: "1", R_A: "1" },
      outputEquations: { Z: "0" },
    });

    expect(result.passed).toBe(false);
    expect(result.mismatches.some((mismatch) => mismatch.type === "EXCITATION" && mismatch.message.includes("Invalid SR input"))).toBe(true);
  });

  it("reports output equation mismatches", () => {
    const result = verifyAllResults({
      stateTable: dRows,
      modelType: "mealy",
      flipFlopType: "d",
      variables,
      nextStateEquations: { "A+": "X" },
      excitationEquations: { D_A: "X" },
      outputEquations: { Z: "0" },
    });

    expect(result.passed).toBe(false);
    expect(result.mismatches.some((mismatch) => mismatch.type === "OUTPUT")).toBe(true);
  });

  it("accepts a singular outputEquation string for one output", () => {
    const result = verifyAllResults({
      stateTable: dRows,
      modelType: "mealy",
      flipFlopType: "d",
      variables,
      excitationEquations: { D_A: "X" },
      outputEquation: "X",
    });

    expect(result.passed).toBe(true);
  });

  it("reports excitation equation mismatches", () => {
    const result = verifyAllResults({
      stateTable: dRows,
      modelType: "mealy",
      flipFlopType: "d",
      variables,
      excitationEquations: { D_A: "0" },
      outputEquations: { Z: "X" },
    });

    expect(result.passed).toBe(false);
    expect(result.mismatches.some((mismatch) => mismatch.type === "EXCITATION")).toBe(true);
  });

  it("warns when a Moore output equation depends on an input", () => {
    const result = verifyAllResults({
      stateTable: dRows,
      modelType: "moore",
      flipFlopType: "d",
      variables,
      outputEquations: { Z: "X" },
    });

    expect(result.warnings.some((warning) => warning.type === "MOORE_OUTPUT_INPUT_DEPENDENCY")).toBe(true);
  });

  it("warns when Moore rows with the same present state disagree on output", () => {
    const result = verifyAllResults({
      stateTable: dRows,
      modelType: "moore",
      flipFlopType: "d",
      variables,
      outputEquations: { Z: "A" },
    });

    expect(result.warnings.some((warning) => warning.type === "MOORE_OUTPUT_CONFLICT")).toBe(true);
  });

  it("marks missing timing and circuit checks as skipped rather than passed", () => {
    const result = verifyAllResults({
      stateTable: dRows,
      modelType: "mealy",
      flipFlopType: "d",
      variables,
      excitationEquations: { D_A: "X" },
      outputEquations: { Z: "X" },
    });

    expect(result.checks.find((check) => check.name === "Timing trace check")).toMatchObject({
      skipped: true,
      passed: false,
    });
    expect(result.checks.find((check) => check.name === "Circuit graph check")).toMatchObject({
      skipped: true,
      passed: false,
    });
    expect(result.passed).toBe(true);
  });

  it("reports JK excitation mismatches with the J/K suspected equations", () => {
    const result = verifyAllResults({
      stateTable: toggleRows,
      modelType: "mealy",
      flipFlopType: "jk",
      variables,
      excitationEquations: { J_A: "0", K_A: "X" },
      outputEquations: { Z: "X" },
    });

    const mismatch = result.mismatches.find((item) => item.type === "EXCITATION");
    expect(result.passed).toBe(false);
    expect(mismatch?.suspectedEquation).toContain("J_A");
    expect(mismatch?.suspectedEquation).toContain("K_A");
  });

  it("checks timing traces against state table rows", () => {
    const result = verifyAllResults({
      stateTable: dRows,
      modelType: "mealy",
      flipFlopType: "d",
      variables,
      outputEquations: { Z: "X" },
      timingTrace: [
        { step: 0, currentState: { A: "0" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "1" } },
        { step: 1, currentState: { A: "1" }, input: { X: "0" }, nextState: { A: "0" }, output: { Z: "0" } },
      ],
    });

    expect(result.checks.find((check) => check.name === "Timing trace check")?.passed).toBe(true);
  });

  it("maps validateCircuitGraph failures into circuit mismatches", () => {
    const circuitGraph: CircuitGraph = {
      nodes: [{ id: "output:Z", type: "OUTPUT", label: "Z", x: 0, y: 0 }],
      edges: [],
      clockLine: { label: "CLK", points: [], branches: [] },
      metadata: {
        width: 0,
        height: 0,
        flipFlopType: "d",
        stateVariables: [],
        inputVariables: [],
        outputVariables: ["Z"],
      },
    };
    const result = verifyAllResults({
      stateTable: [],
      modelType: "mealy",
      flipFlopType: "d",
      variables: { inputs: [], states: [], outputs: ["Z"], clock: "CLK" },
      circuitGraph,
    });

    expect(result.passed).toBe(false);
    expect(result.mismatches.some((mismatch) => mismatch.type === "CIRCUIT")).toBe(true);
  });
});
