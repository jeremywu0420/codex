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

// A complete two-state 2-bit up counter, used to prove the present state never leaks from a
// state-table row (the reset must win at step 0).
const counterVariables: Variables = {
  clock: "CLK",
  inputs: ["X"],
  outputs: ["Z"],
  states: ["A", "B"],
};

const counterRows: StateTableRow[] = [
  { id: "00-0", currentState: { A: "0", B: "0" }, input: { X: "0" }, nextState: { A: "0", B: "0" }, output: { Z: "0" } },
  { id: "00-1", currentState: { A: "0", B: "0" }, input: { X: "1" }, nextState: { A: "0", B: "1" }, output: { Z: "0" } },
  { id: "01-0", currentState: { A: "0", B: "1" }, input: { X: "0" }, nextState: { A: "0", B: "1" }, output: { Z: "0" } },
  { id: "01-1", currentState: { A: "0", B: "1" }, input: { X: "1" }, nextState: { A: "1", B: "0" }, output: { Z: "0" } },
  { id: "10-0", currentState: { A: "1", B: "0" }, input: { X: "0" }, nextState: { A: "1", B: "0" }, output: { Z: "0" } },
  { id: "10-1", currentState: { A: "1", B: "0" }, input: { X: "1" }, nextState: { A: "1", B: "1" }, output: { Z: "0" } },
  { id: "11-0", currentState: { A: "1", B: "1" }, input: { X: "0" }, nextState: { A: "1", B: "1" }, output: { Z: "1" } },
  { id: "11-1", currentState: { A: "1", B: "1" }, input: { X: "1" }, nextState: { A: "0", B: "0" }, output: { Z: "1" } },
];

describe("testbench simulation", () => {
  it("takes only the input stimulus from the timing trace and re-derives state from reset", () => {
    const result = runTestbenchSimulation({
      stateTable: rows,
      variables,
      modelType: "mealy",
      flipFlopType: "d",
      initialStateBits: "0",
      timingTrace: [
        // The state/next columns below are intentionally wrong; they must be ignored.
        { step: 0, currentState: { A: "1" }, input: { X: "1" }, nextState: { A: "0" }, output: { Z: "0" } },
        { step: 1, currentState: { A: "0" }, input: { X: "0" }, nextState: { A: "1" }, output: { Z: "0" } },
      ],
    });

    expect(result.status).toBe("pass");
    expect(result.consoleLines).toEqual(["PASS step 0", "PASS step 1"]);
    // Step 0 present state is the reset (0), not the trace's "1".
    expect(result.rows[0]).toMatchObject({
      inputBits: "1",
      expectedPresentState: "0",
      actualPresentState: "0",
      expectedOutput: "1",
      actualOutput: "1",
      expectedNextState: "1",
      actualNextState: "1",
      result: "pass",
    });
    // The next state only becomes the current state on the following clock.
    expect(result.rows[1].expectedPresentState).toBe("1");
    expect(result.rows[1].actualPresentState).toBe("1");
  });

  it("starts expected and actual from the same configured reset state (no 00-vs-10 split)", () => {
    const result = runTestbenchSimulation({
      stateTable: rows,
      variables,
      modelType: "mealy",
      flipFlopType: "d",
      initialStateBits: "1",
      timingTrace: [{ step: 0, currentState: { A: "1" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "0" } }],
    });

    expect(result.status).toBe("pass");
    expect(result.rows[0]).toMatchObject({
      expectedPresentState: "1",
      actualPresentState: "1",
      expectedOutput: "0",
      actualOutput: "0",
      expectedNextState: "1",
      actualNextState: "1",
      result: "pass",
    });
  });

  it("resets a multi-bit machine to 00 at step 0 instead of a state-table row", () => {
    const result = runTestbenchSimulation({
      stateTable: counterRows,
      variables: counterVariables,
      modelType: "moore",
      flipFlopType: "d",
      initialStateBits: "00",
      timingTrace: null,
    });

    expect(result.status).toBe("pass");
    expect(result.rows[0].expectedPresentState).toBe("00");
    expect(result.rows[0].actualPresentState).toBe("00");
    // Default sequence is 0,1,0,1,...; step 1 keeps state 00 (X=1 -> next 01), step 2 sees 01.
    expect(result.rows[1].expectedPresentState).toBe("00");
    expect(result.rows[2].expectedPresentState).toBe("01");
  });

  it("flags an incomplete table (missing transition row) as a failing step", () => {
    const result = runTestbenchSimulation({
      stateTable: rows.filter((row) => row.id !== "0-1"),
      variables,
      modelType: "mealy",
      flipFlopType: "d",
      initialStateBits: "0",
      timingTrace: [{ step: 0, currentState: { A: "0" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "1" } }],
    });

    expect(result.status).toBe("fail");
    expect(result.rows[0]).toMatchObject({ expectedNextState: "X", actualNextState: "X", result: "fail" });
  });
});
