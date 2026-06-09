import { describe, expect, it } from "vitest";
import { buildCodeGeneratorArtifacts } from "./codeGenerator";
import type { TimingStep } from "./timing";
import type { Equation, StateTableRow, Variables } from "../types";

const variables: Variables = {
  clock: "CLK",
  inputs: ["X"],
  outputs: ["Z"],
  states: ["A"],
};

const rows: StateTableRow[] = [
  { id: "0-0", currentState: { A: "0" }, input: { X: "0" }, nextState: { A: "0" }, output: { Z: "0" } },
  { id: "0-1", currentState: { A: "0" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "1" } },
  { id: "1-0", currentState: { A: "1" }, input: { X: "0" }, nextState: { A: "0" }, output: { Z: "1" } },
  { id: "1-1", currentState: { A: "1" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "0" } },
];

const equations: Equation[] = [
  { id: "J_A", label: "J_A", variableNames: ["A", "X"], minterms: [], dontCares: [], expression: "X" },
  { id: "K_A", label: "K_A", variableNames: ["A", "X"], minterms: [], dontCares: [], expression: "X'" },
  { id: "Z", label: "Z", variableNames: ["A", "X"], minterms: [], dontCares: [], expression: "A'X + AX'" },
];

const timingTrace: TimingStep[] = [
  { step: 3, currentState: { A: "1" }, input: { X: "0" }, nextState: { A: "0" }, output: { Z: "1" } },
];

const passedVerification = {
  checks: [],
  mismatches: [],
  passed: true,
  warnings: [],
};

describe("code generator", () => {
  it("uses the current state table for behavioral Verilog case statements", () => {
    const artifacts = buildCodeGeneratorArtifacts({
      equations,
      flipFlopType: "jk",
      modelType: "mealy",
      stateTable: rows,
      timingTrace,
      variables,
      verification: passedVerification,
    });

    expect(artifacts.behavioralVerilog).toContain("case (state)");
    expect(artifacts.behavioralVerilog).toContain("case (X)");
    expect(artifacts.behavioralVerilog).toContain("next_state = S_1;");
    expect(artifacts.behavioralVerilog).toContain("Z = 1'b1;");
  });

  it("uses supplied simplified equations for gate-level assignments", () => {
    const artifacts = buildCodeGeneratorArtifacts({
      equations,
      flipFlopType: "jk",
      modelType: "mealy",
      stateTable: rows,
      timingTrace,
      variables,
      verification: passedVerification,
    });

    expect(artifacts.gateLevelVerilog).toContain("wire J_A;");
    expect(artifacts.gateLevelVerilog).toContain("wire K_A;");
    expect(artifacts.gateLevelVerilog).toContain("assign J_A = X;");
    expect(artifacts.gateLevelVerilog).toContain("assign K_A = ~X;");
    expect(artifacts.gateLevelVerilog).toContain("assign Z = ~A & X | A & ~X;");
  });

  it("uses the timing trace for testbench inputs, expected outputs, and state checks", () => {
    const artifacts = buildCodeGeneratorArtifacts({
      equations,
      flipFlopType: "jk",
      modelType: "mealy",
      stateTable: rows,
      timingTrace,
      variables,
      verification: passedVerification,
    });

    expect(artifacts.testbench).toContain("run_step(3, 1'b0, 1'b1, 1'b1, 1'b0);");
    expect(artifacts.testbench).toContain("FAIL step %0d: expected z=%b, got z=%b");
    expect(artifacts.testbench).toContain("FAIL step %0d: expected state=%b, got state=%b");
  });

  it("blocks generation when the state table contains don't-care values", () => {
    const incompleteRows = rows.map((row, index) => (index === 0 ? { ...row, output: { Z: "-" as const } } : row));
    const artifacts = buildCodeGeneratorArtifacts({
      equations,
      flipFlopType: "jk",
      modelType: "mealy",
      stateTable: incompleteRows,
      timingTrace,
      variables,
      verification: passedVerification,
    });

    expect(artifacts.isStateTableComplete).toBe(false);
    expect(artifacts.missingDataMessage).toBe("Please complete the state table before generating Verilog/Testbench.");
  });
});
