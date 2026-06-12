import { describe, expect, it } from "vitest";
import type { StateTableRow, Variables } from "../types";
import { lintDesign } from "./designLint";

const variables: Variables = { inputs: ["X"], states: ["A", "B"], outputs: ["Z"], clock: "CLK" };

function row(current: string, input: string, next: string, output: string): StateTableRow {
  return {
    id: `s${current}-x${input}`,
    currentState: { A: current[0] as "0" | "1", B: current[1] as "0" | "1" },
    input: { X: input as "0" | "1" },
    nextState: { A: next[0] as "0" | "1" | "-", B: next[1] as "0" | "1" | "-" },
    output: { Z: output as "0" | "1" | "-" },
  };
}

function fullTable() {
  return [
    row("00", "0", "01", "0"),
    row("00", "1", "10", "0"),
    row("01", "0", "10", "0"),
    row("01", "1", "11", "1"),
    row("10", "0", "01", "0"),
    row("10", "1", "11", "1"),
    row("11", "0", "00", "1"),
    row("11", "1", "01", "1"),
  ];
}

describe("design lint", () => {
  it("passes a complete, reachable table", () => {
    const result = lintDesign({ stateTable: fullTable(), variables, modelType: "mealy", initialStateBits: "00" });
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
  });

  it("flags don't-care next states as warnings", () => {
    const table = fullTable();
    table[0] = row("00", "0", "-1", "0");
    const result = lintDesign({ stateTable: table, variables, modelType: "mealy", initialStateBits: "00" });
    expect(result.issues.some((issue) => issue.code === "dontcare-next-state")).toBe(true);
  });

  it("detects unreachable states", () => {
    const table = [
      row("00", "0", "00", "0"),
      row("00", "1", "01", "0"),
      row("01", "0", "00", "0"),
      row("01", "1", "01", "0"),
      row("10", "0", "10", "0"),
      row("10", "1", "10", "0"),
      row("11", "0", "11", "0"),
      row("11", "1", "11", "0"),
    ];
    const result = lintDesign({ stateTable: table, variables, modelType: "mealy", initialStateBits: "00" });
    const unreachable = result.issues.find((issue) => issue.code === "unreachable-state");
    expect(unreachable?.message).toContain("state 10");
    expect(unreachable?.message).toContain("state 11");
  });

  it("detects Moore output conflicts", () => {
    const table = fullTable();
    // state 01 has Z=0 on input 0 but Z=1 on input 1 -> invalid for Moore
    const result = lintDesign({ stateTable: table, variables, modelType: "moore", initialStateBits: "00" });
    expect(result.issues.some((issue) => issue.code === "moore-output-conflict")).toBe(true);
  });

  it("rejects an invalid initial state", () => {
    const result = lintDesign({ stateTable: fullTable(), variables, modelType: "mealy", initialStateBits: "0" });
    expect(result.issues.some((issue) => issue.code === "invalid-initial-state")).toBe(true);
  });

  it("detects duplicate transition rows", () => {
    const table = [...fullTable(), row("00", "0", "11", "1")];
    const result = lintDesign({ stateTable: table, variables, modelType: "mealy", initialStateBits: "00" });
    expect(result.issues.some((issue) => issue.code === "duplicate-transition")).toBe(true);
  });
});
