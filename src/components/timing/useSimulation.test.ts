import { describe, expect, it } from "vitest";
import { buildInteractiveSimulation } from "./useSimulation";
import type { StateTableRow, Variables } from "../../types";

const variables: Variables = {
  clock: "CLK",
  inputs: ["X"],
  outputs: ["Z"],
  states: ["A", "B"],
};

const rows: StateTableRow[] = [
  { id: "00-0", currentState: { A: "0", B: "0" }, input: { X: "0" }, nextState: { A: "0", B: "1" }, output: { Z: "0" } },
  { id: "00-1", currentState: { A: "0", B: "0" }, input: { X: "1" }, nextState: { A: "1", B: "0" }, output: { Z: "0" } },
  { id: "01-0", currentState: { A: "0", B: "1" }, input: { X: "0" }, nextState: { A: "1", B: "0" }, output: { Z: "0" } },
  { id: "01-1", currentState: { A: "0", B: "1" }, input: { X: "1" }, nextState: { A: "1", B: "1" }, output: { Z: "1" } },
  { id: "10-0", currentState: { A: "1", B: "0" }, input: { X: "0" }, nextState: { A: "0", B: "1" }, output: { Z: "0" } },
  { id: "10-1", currentState: { A: "1", B: "0" }, input: { X: "1" }, nextState: { A: "1", B: "1" }, output: { Z: "1" } },
  { id: "11-0", currentState: { A: "1", B: "1" }, input: { X: "0" }, nextState: { A: "0", B: "0" }, output: { Z: "1" } },
  { id: "11-1", currentState: { A: "1", B: "1" }, input: { X: "1" }, nextState: { A: "0", B: "1" }, output: { Z: "1" } },
];

describe("interactive timing simulation", () => {
  it("builds pass/fail cycle rows and console lines from the FSM state table", () => {
    const simulation = buildInteractiveSimulation({
      stateTable: rows,
      variables,
      modelType: "mealy",
      flipFlopType: "jk",
      initialStateBits: "00",
      inputSequenceText: "0 1 0",
    });

    expect(simulation.passed).toBe(true);
    expect(simulation.consoleLines).toEqual(["PASS step 0", "PASS step 1", "PASS step 2"]);
    expect(simulation.cycles.map((cycle) => cycle.actualPresentState)).toEqual(["00", "01", "11"]);
    expect(simulation.cycles.map((cycle) => cycle.inputBits)).toEqual(["0", "1", "0"]);
    expect(simulation.cycles.map((cycle) => cycle.actualOutput)).toEqual(["0", "1", "1"]);
    expect(simulation.cycles.map((cycle) => cycle.actualNextState)).toEqual(["01", "11", "00"]);
  });

  it("rejects malformed input sequence text before rendering the SVG simulator", () => {
    expect(() =>
      buildInteractiveSimulation({
        stateTable: rows,
        variables,
        modelType: "mealy",
        flipFlopType: "jk",
        initialStateBits: "00",
        inputSequenceText: "0 2 1",
      }),
    ).toThrow("Timing diagram generation failed: input sequence must contain only 0 or 1 values.");
  });
});
