import type { Bit, FlipFlopType, ModelType, StateTableRow, Variables } from "../types";
import { buildDefaultInputSequence, generateTimingData } from "./timing";
import type { TimingStep } from "./timing";

export type SimulationStatus = "pass" | "fail";

export interface SimulationStepResult {
  step: number;
  inputBits: string;
  expectedPresentState: string;
  actualPresentState: string;
  expectedOutput: string;
  actualOutput: string;
  expectedNextState: string;
  actualNextState: string;
  result: SimulationStatus;
}

export interface TestbenchSimulationResult {
  status: SimulationStatus;
  rows: SimulationStepResult[];
  consoleLines: string[];
}

export interface RunTestbenchSimulationInput {
  stateTable: StateTableRow[];
  variables: Variables;
  modelType: ModelType;
  flipFlopType: FlipFlopType;
  initialStateBits: string;
  timingTrace: TimingStep[] | null;
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

function expectedStepsFor(input: RunTestbenchSimulationInput) {
  if (input.timingTrace?.length) return input.timingTrace;
  const initialState = bitRecordFromBits(input.variables.states, input.initialStateBits);
  return generateTimingData(
    input.stateTable,
    input.modelType,
    input.flipFlopType,
    input.variables.states,
    input.variables.inputs,
    input.variables.outputs,
    buildDefaultInputSequence(input.variables.inputs),
    initialState,
  ).steps;
}

function consoleLineFor(row: SimulationStepResult) {
  if (row.result === "pass") return `PASS step ${row.step}`;
  return [
    `FAIL step ${row.step}:`,
    `expected state=${row.expectedPresentState}, output=${row.expectedOutput}, next=${row.expectedNextState};`,
    `got state=${row.actualPresentState}, output=${row.actualOutput}, next=${row.actualNextState}`,
  ].join(" ");
}

export function runTestbenchSimulation(input: RunTestbenchSimulationInput): TestbenchSimulationResult {
  const expectedSteps = expectedStepsFor(input);
  let actualStateBits = "0".repeat(input.variables.states.length);

  const rows = expectedSteps.map((step) => {
    const inputBits = bitsFromRecord(input.variables.inputs, step.input);
    const expectedPresentState = bitsFromRecord(input.variables.states, step.currentState);
    const expectedOutputBits = bitsFromRecord(input.variables.outputs, step.output);
    const expectedNextState = bitsFromRecord(input.variables.states, step.nextState);
    const transitionRow = findTransitionRow(input.stateTable, input.variables, actualStateBits, inputBits);
    const actualOutputBits = transitionRow ? bitsFromRecord(input.variables.outputs, transitionRow.output) : "X".repeat(input.variables.outputs.length);
    const actualNextState = transitionRow ? bitsFromRecord(input.variables.states, transitionRow.nextState) : "X".repeat(input.variables.states.length);
    const result =
      expectedPresentState === actualStateBits && expectedOutputBits === actualOutputBits && expectedNextState === actualNextState
        ? "pass"
        : "fail";

    const simulationRow: SimulationStepResult = {
      step: step.step,
      inputBits,
      expectedPresentState,
      actualPresentState: actualStateBits,
      expectedOutput: expectedOutputBits,
      actualOutput: actualOutputBits,
      expectedNextState,
      actualNextState,
      result,
    };

    actualStateBits = actualNextState;
    return simulationRow;
  });

  return {
    status: rows.every((row) => row.result === "pass") ? "pass" : "fail",
    rows,
    consoleLines: rows.map(consoleLineFor),
  };
}
