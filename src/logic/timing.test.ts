import { describe, expect, it } from "vitest";
import type { StateTableRow } from "../types";
import { buildDigitalWavePath, generateTimingData, renderTimingDiagramSVG, timingStepsToConsoleRows } from "./timing";

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

const inputSequence = ["0", "1", "0", "1", "0", "1", "0", "1"].map((value) => ({ X: value as "0" | "1" }));

describe("timing diagram logic", () => {
  it("builds right-angle digital waveform paths", () => {
    expect(buildDigitalWavePath(["0", "1", "1", "0"], 120, 10, 30, 80)).toBe(
      "M 120 30 L 200 30 L 200 30 L 200 10 L 280 10 L 360 10 L 360 10 L 360 30 L 440 30",
    );
  });

  it("generates D flip-flop timing signals from next state values", () => {
    const data = generateTimingData(rows, "mealy", "d", ["A", "B"], ["X"], ["Z"], inputSequence);

    expect(data.signals.map((signal) => signal.name)).toEqual(["Clock", "X", "QA", "QB", "Z"]);
    expect(data.signals.find((signal) => signal.name === "X")?.values).toEqual(["0", "1", "0", "1", "0", "1", "0", "1"]);
    expect(data.signals.find((signal) => signal.name === "QA")?.values).toEqual(["0", "0", "1", "0", "1", "0", "1", "0"]);
    expect(data.signals.find((signal) => signal.name === "QB")?.values).toEqual(["0", "1", "1", "0", "0", "1", "1", "0"]);
    expect(data.signals.find((signal) => signal.name === "Z")?.values).toEqual(["0", "1", "1", "0", "0", "1", "1", "0"]);
  });

  it("keeps timing traces independent from flip-flop excitation inputs", () => {
    const flipFlopTypes = ["jk", "d", "t", "sr"] as const;

    for (const flipFlopType of flipFlopTypes) {
      const data = generateTimingData(rows, "mealy", flipFlopType, ["A", "B"], ["X"], ["Z"], inputSequence);
      expect(data.signals.map((signal) => signal.name)).toEqual(["Clock", "X", "QA", "QB", "Z"]);
      expect(data.signals.some((signal) => /^[DJKT]|^[SR][A-Z0-9]/.test(signal.name))).toBe(false);
    }
  });

  it("rejects incomplete next-state values used by simulation", () => {
    const incompleteRows: StateTableRow[] = [
      { id: "0-0", currentState: { A: "0" }, input: { X: "0" }, nextState: { A: "-" }, output: { Z: "0" } },
    ];

    expect(() => generateTimingData(incompleteRows, "moore", "d", ["A"], ["X"], ["Z"], [{ X: "0" }])).toThrow(
      "Please complete all next state values before generating timing diagram.",
    );
  });

  it("rejects incomplete observed state table values before rendering", () => {
    const incompleteRows: StateTableRow[] = [
      { id: "0-0", currentState: { A: "0" }, input: { X: "0" }, nextState: { A: "1" }, output: { Z: "-" } },
    ];

    expect(() => generateTimingData(incompleteRows, "moore", "d", ["A"], ["X"], ["Z"])).toThrow(
      "Please complete all output values before generating timing diagram.",
    );
  });

  it("reports the missing state table row for the failed step", () => {
    const missingRows = rows.filter((row) => !(row.currentState.A === "0" && row.currentState.B === "1" && row.input.X === "1"));

    expect(() => generateTimingData(missingRows, "mealy", "jk", ["A", "B"], ["X"], ["Z"], inputSequence)).toThrow(
      "No matching state table row for A=0, B=1, X=1",
    );
  });

  it("renders an SVG without excitation rows or bottom annotations", () => {
    const data = generateTimingData(rows, "mealy", "jk", ["A", "B"], ["X"], ["Z"], inputSequence);
    const svg = renderTimingDiagramSVG(data);

    expect(svg).toContain("Timing Diagram");
    expect(svg).toContain("stroke-dasharray=\"3 4\"");
    expect(svg).toContain(">QA</text>");
    expect(svg).not.toContain(">JA</text>");
    expect(svg).not.toContain(">KA</text>");
    expect(svg).not.toContain("Z=");
  });

  it("builds debug rows for each clock step", () => {
    const data = generateTimingData(rows, "mealy", "jk", ["A", "B"], ["X"], ["Z"], inputSequence);

    expect(timingStepsToConsoleRows(data.steps)).toEqual([
      { step: 0, currentA: "0", currentB: "0", x: "0", nextA: "0", nextB: "1", z: "0" },
      { step: 1, currentA: "0", currentB: "1", x: "1", nextA: "1", nextB: "1", z: "1" },
      { step: 2, currentA: "1", currentB: "1", x: "0", nextA: "0", nextB: "0", z: "1" },
      { step: 3, currentA: "0", currentB: "0", x: "1", nextA: "1", nextB: "0", z: "0" },
      { step: 4, currentA: "1", currentB: "0", x: "0", nextA: "0", nextB: "1", z: "0" },
      { step: 5, currentA: "0", currentB: "1", x: "1", nextA: "1", nextB: "1", z: "1" },
      { step: 6, currentA: "1", currentB: "1", x: "0", nextA: "0", nextB: "0", z: "1" },
      { step: 7, currentA: "0", currentB: "0", x: "1", nextA: "1", nextB: "0", z: "0" },
    ]);
  });
});
