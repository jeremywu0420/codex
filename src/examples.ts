import type { Bit, FlipFlopType, LogicValue, ModelType, StateTableRow } from "./types";

export interface ExamplePreset {
  id: string;
  name: string;
  description: string;
  modelType: ModelType;
  flipFlopType: FlipFlopType;
  inputs: string[];
  outputs: string[];
  initialStateBits: string;
  /** "presentBits|inputBits" -> { next: nextStateBits, out: outputBits } */
  transitions: Record<string, { next: string; out: string }>;
}

const STATES = ["A", "B"];

function bitRecord(names: string[], bits: string) {
  return Object.fromEntries(names.map((name, index) => [name, (bits[index] ?? "0") as Bit])) as Record<string, Bit>;
}

function logicRecord(names: string[], bits: string) {
  return Object.fromEntries(names.map((name, index) => [name, (bits[index] ?? "-") as LogicValue])) as Record<string, LogicValue>;
}

export function exampleToStateTable(example: ExamplePreset): StateTableRow[] {
  const stateCount = 2 ** STATES.length;
  const inputCount = 2 ** example.inputs.length;
  const rows: StateTableRow[] = [];
  for (let stateIndex = 0; stateIndex < stateCount; stateIndex += 1) {
    const stateBits = stateIndex.toString(2).padStart(STATES.length, "0");
    for (let inputIndex = 0; inputIndex < inputCount; inputIndex += 1) {
      const inputBits = inputIndex.toString(2).padStart(example.inputs.length, "0");
      const transition = example.transitions[`${stateBits}|${inputBits}`] ?? { next: "-".repeat(STATES.length), out: "-".repeat(example.outputs.length) };
      rows.push({
        id: `s${stateBits}-x${inputBits}`,
        currentState: bitRecord(STATES, stateBits),
        input: bitRecord(example.inputs, inputBits),
        nextState: logicRecord(STATES, transition.next),
        output: logicRecord(example.outputs, transition.out),
      });
    }
  }
  return rows;
}

export const examplePresets: ExamplePreset[] = [
  {
    id: "mealy-d-101",
    name: "101 Sequence Detector (Mealy + D)",
    description: "Z pulses to 1 in the same cycle the input completes the overlapping pattern 1-0-1.",
    modelType: "mealy",
    flipFlopType: "d",
    inputs: ["X"],
    outputs: ["Z"],
    initialStateBits: "00",
    transitions: {
      "00|0": { next: "00", out: "0" }, // idle
      "00|1": { next: "01", out: "0" }, // saw 1
      "01|0": { next: "10", out: "0" }, // saw 10
      "01|1": { next: "01", out: "0" },
      "10|0": { next: "00", out: "0" },
      "10|1": { next: "01", out: "1" }, // 101 detected
      "11|0": { next: "00", out: "0" }, // unused state, recover to idle
      "11|1": { next: "01", out: "0" },
    },
  },
  {
    id: "mealy-jk-updown",
    name: "Up/Down Counter with Carry (Mealy + JK)",
    description: "X=1 counts up, X=0 counts down. Z=1 on wrap-around (carry/borrow).",
    modelType: "mealy",
    flipFlopType: "jk",
    inputs: ["X"],
    outputs: ["Z"],
    initialStateBits: "00",
    transitions: {
      "00|0": { next: "11", out: "1" },
      "00|1": { next: "01", out: "0" },
      "01|0": { next: "00", out: "0" },
      "01|1": { next: "10", out: "0" },
      "10|0": { next: "01", out: "0" },
      "10|1": { next: "11", out: "0" },
      "11|0": { next: "10", out: "0" },
      "11|1": { next: "00", out: "1" },
    },
  },
  {
    id: "moore-d-11",
    name: "Consecutive 11 Detector (Moore + D)",
    description: "Z=1 while the machine sits in the state reached after two consecutive 1 inputs.",
    modelType: "moore",
    flipFlopType: "d",
    inputs: ["X"],
    outputs: ["Z"],
    initialStateBits: "00",
    transitions: {
      "00|0": { next: "00", out: "0" }, // no ones seen
      "00|1": { next: "01", out: "0" },
      "01|0": { next: "00", out: "0" }, // one 1 seen
      "01|1": { next: "10", out: "0" },
      "10|0": { next: "00", out: "1" }, // detected, Z=1 in this state
      "10|1": { next: "10", out: "1" },
      "11|0": { next: "00", out: "0" }, // unused state, recover to idle
      "11|1": { next: "01", out: "0" },
    },
  },
  {
    id: "moore-t-counter",
    name: "2-bit Counter with Enable (Moore + T)",
    description: "X=1 enables counting 00->01->10->11->00. Z=1 in state 11.",
    modelType: "moore",
    flipFlopType: "t",
    inputs: ["X"],
    outputs: ["Z"],
    initialStateBits: "00",
    transitions: {
      "00|0": { next: "00", out: "0" },
      "00|1": { next: "01", out: "0" },
      "01|0": { next: "01", out: "0" },
      "01|1": { next: "10", out: "0" },
      "10|0": { next: "10", out: "0" },
      "10|1": { next: "11", out: "0" },
      "11|0": { next: "11", out: "1" },
      "11|1": { next: "00", out: "1" },
    },
  },
  {
    id: "incomplete-demo",
    name: "Incomplete Table Demo (Validation)",
    description: "Deliberately leaves don't-care cells so you can see how validation and the diagrams react.",
    modelType: "mealy",
    flipFlopType: "d",
    inputs: ["X"],
    outputs: ["Z"],
    initialStateBits: "00",
    transitions: {
      "00|0": { next: "01", out: "0" },
      "00|1": { next: "10", out: "0" },
      "01|0": { next: "10", out: "0" },
      "01|1": { next: "11", out: "1" },
      "10|0": { next: "-1", out: "-" }, // intentionally incomplete
      "10|1": { next: "11", out: "1" },
      // rows for state 11 intentionally left as don't-cares
    },
  },
];

export function findExample(id: string) {
  return examplePresets.find((example) => example.id === id) ?? null;
}
