import { describe, expect, it } from "vitest";
import { runTestbenchSimulation } from "./testbenchSimulation";
import type { StateTableRow, Variables } from "../types";

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

describe("testbench simulation", () => {
  it("passes when the expected trace starts from the generated Verilog reset state", () => {
    const result = runTestbenchSimulation({
      stateTable: rows,
      variables,
      modelType: "mealy",
      flipFlopType: "d",
      initialStateBits: "0",
      timingTrace: [
        { step: 0, currentState: { A: "0" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "1" } },
        { step: 1, currentState: { A: "1" }, input: { X: "0" }, nextState: { A: "0" }, output: { Z: "1" } },
      ],
    });

    expect(result.status).toBe("pass");
    expect(result.consoleLines).toEqual(["PASS step 0", "PASS step 1"]);
    expect(result.rows[0]).toMatchObject({
      inputBits: "1",
      expectedOutput: "1",
      actualOutput: "1",
      expectedNextState: "1",
      actualNextState: "1",
      result: "pass",
    });
  });

  it("fails when the expected testbench state does not match the generated Verilog reset state", () => {
    const result = runTestbenchSimulation({
      stateTable: rows,
      variables,
      modelType: "mealy",
      flipFlopType: "d",
      initialStateBits: "1",
      timingTrace: [{ step: 0, currentState: { A: "1" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "0" } }],
    });

    expect(result.status).toBe("fail");
    expect(result.consoleLines[0]).toContain("FAIL step 0");
    expect(result.rows[0]).toMatchObject({
      actualPresentState: "0",
      expectedPresentState: "1",
      expectedOutput: "0",
      actualOutput: "1",
      result: "fail",
    });
  });
});
