import { describe, expect, it } from "vitest";
import { buildKMap, grayOrder, termCoversAssignment } from "./kmap";
import type { Equation } from "../types";

describe("k-map grouping", () => {
  it("generates gray-code orderings", () => {
    expect(grayOrder(1)).toEqual(["0", "1"]);
    expect(grayOrder(2)).toEqual(["00", "01", "11", "10"]);
  });

  it("matches product terms against cell assignments", () => {
    const names = ["A", "B", "X"];
    expect(termCoversAssignment("A'BX", names, "011")).toBe(true);
    expect(termCoversAssignment("A'BX", names, "111")).toBe(false);
    expect(termCoversAssignment("B", names, "010")).toBe(true);
    expect(termCoversAssignment("1", names, "000")).toBe(true);
  });

  it("assigns each group only the cells its term covers", () => {
    // F = A'B + AX over variables A, B, X
    const equation: Equation = {
      id: "f",
      label: "F",
      variableNames: ["A", "B", "X"],
      minterms: [2, 3, 5, 7],
      dontCares: [],
      expression: "A'B + AX",
    };
    const map = buildKMap(equation);
    const byTerm = Object.fromEntries(map.groups.map((group) => [group.term, [...group.cells].sort()]));
    expect(byTerm["A'B"]).toEqual([2, 3]); // 010, 011
    expect(byTerm["AX"]).toEqual([5, 7]); // 101, 111
  });

  it("handles multi-character variable names", () => {
    expect(termCoversAssignment("X1'X2", ["X1", "X2"], "01")).toBe(true);
    expect(termCoversAssignment("X1'X2", ["X1", "X2"], "11")).toBe(false);
  });
});
