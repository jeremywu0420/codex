import type { Bit, FlipFlopType, ModelType, StateTableRow, Variables } from "../types";
import { generateTimingData, parseInputSequence } from "./timing";
import type { TimingData, TimingStep } from "./timing";

export type CycleResult = "pass" | "fail";

export interface SimulationCycle {
  step: number;
  inputBits: string;
  expectedPresentState: string;
  actualPresentState: string;
  expectedOutput: string;
  actualOutput: string;
  expectedNextState: string;
  actualNextState: string;
  result: CycleResult;
  consoleLine: string;
  stepData: TimingStep;
}

export interface InteractiveSimulation {
  timingData: TimingData;
  cycles: SimulationCycle[];
  consoleLines: string[];
  passed: boolean;
}

export interface BuildInteractiveSimulationInput {
  stateTable: StateTableRow[];
  variables: Variables;
  modelType: ModelType;
  flipFlopType: FlipFlopType;
  initialStateBits: string;
  inputSequenceText: string;
}

function bitsFromRecord(names: string[], record: Record<string, string | undefined>) {
  return names.map((name) => record[name] ?? "X").join("");
}

function bitRecordFromBits(names: string[], bits: string) {
  return Object.fromEntries(names.map((name, index) => [name, (bits[index] === "1" ? "1" : "0") as Bit])) as Record<string, Bit>;
}

function isBinaryBits(bits: string) {
  return bits.length > 0 && [...bits].every((bit) => bit === "0" || bit === "1");
}

function findTransitionRow(rows: StateTableRow[], variables: Variables, stateBits: string, inputBits: string) {
  if (!isBinaryBits(stateBits) || !isBinaryBits(inputBits)) return null;
  return (
    rows.find(
      (row) =>
        bitsFromRecord(variables.states, row.currentState) === stateBits &&
        bitsFromRecord(variables.inputs, row.input) === inputBits,
    ) ?? null
  );
}

function consoleLineFor(cycle: Omit<SimulationCycle, "consoleLine" | "stepData">) {
  if (cycle.result === "pass") return `PASS step ${cycle.step}`;
  return [
    `FAIL step ${cycle.step}:`,
    `expected state=${cycle.expectedPresentState}, output=${cycle.expectedOutput}, next=${cycle.expectedNextState};`,
    `got state=${cycle.actualPresentState}, output=${cycle.actualOutput}, next=${cycle.actualNextState}`,
  ].join(" ");
}

export function buildInteractiveSimulation(input: BuildInteractiveSimulationInput): InteractiveSimulation {
  const inputSequence = parseInputSequence(input.inputSequenceText, input.variables.inputs);
  const initialState = bitRecordFromBits(input.variables.states, input.initialStateBits);
  const timingData = generateTimingData(
    input.stateTable,
    input.modelType,
    input.flipFlopType,
    input.variables.states,
    input.variables.inputs,
    input.variables.outputs,
    inputSequence,
    initialState,
  );
  let actualStateBits = input.initialStateBits;

  const cycles = timingData.steps.map((step) => {
    const inputBits = bitsFromRecord(input.variables.inputs, step.input);
    const expectedPresentState = bitsFromRecord(input.variables.states, step.currentState);
    const expectedOutput = bitsFromRecord(input.variables.outputs, step.output);
    const expectedNextState = bitsFromRecord(input.variables.states, step.nextState);
    const transitionRow = findTransitionRow(input.stateTable, input.variables, actualStateBits, inputBits);
    const actualOutput = transitionRow ? bitsFromRecord(input.variables.outputs, transitionRow.output) : "X".repeat(input.variables.outputs.length);
    const actualNextState = transitionRow ? bitsFromRecord(input.variables.states, transitionRow.nextState) : "X".repeat(input.variables.states.length);
    const result: CycleResult =
      expectedPresentState === actualStateBits && expectedOutput === actualOutput && expectedNextState === actualNextState
        ? "pass"
        : "fail";
    const cycle = {
      step: step.step,
      inputBits,
      expectedPresentState,
      actualPresentState: actualStateBits,
      expectedOutput,
      actualOutput,
      expectedNextState,
      actualNextState,
      result,
    };

    actualStateBits = actualNextState;
    return {
      ...cycle,
      consoleLine: consoleLineFor(cycle),
      stepData: step,
    };
  });

  return {
    timingData,
    cycles,
    consoleLines: cycles.map((cycle) => cycle.consoleLine),
    passed: cycles.every((cycle) => cycle.result === "pass"),
  };
}
