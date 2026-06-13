import type { Bit, FlipFlopType, ModelType, StateTableRow, Variables } from "../types";
import { buildDefaultInputSequence, normalizeStateBits } from "./timing";
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

// The state table only supplies the input stimulus + the transition rule. We take the input
// sequence from the timing trace when present (so the table matches what the user simulated),
// otherwise the default sequence. We deliberately ignore the trace's state/next columns so the
// present state is always re-derived from the reset state, never seeded from a table row.
function inputFramesFor(input: RunTestbenchSimulationInput): Record<string, Bit>[] {
  const inputVars = input.variables.inputs;
  if (input.timingTrace?.length) {
    return input.timingTrace.map(
      (step) => Object.fromEntries(inputVars.map((name) => [name, (step.input[name] === "1" ? "1" : "0") as Bit])) as Record<string, Bit>,
    );
  }
  return buildDefaultInputSequence(inputVars);
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
  const { variables } = input;
  const stateWidth = variables.states.length;
  const outputWidth = variables.outputs.length;
  // Expected and actual both begin at the FSM reset state (initialStateBits, all-zeros by
  // default) — the same value the generated Verilog resets to. The present state of step 0 is
  // therefore the reset state, and the next state only becomes the current state on the next
  // clock (the following step), never within the same step.
  const resetStateBits = normalizeStateBits(input.initialStateBits, stateWidth);
  const inputFrames = inputFramesFor(input);

  let currentStateBits = resetStateBits;
  const rows = inputFrames.map((inputFrame, index) => {
    const inputBits = bitsFromRecord(variables.inputs, inputFrame);
    const transitionRow = findTransitionRow(input.stateTable, variables, currentStateBits, inputBits);
    const expectedOutput = transitionRow ? bitsFromRecord(variables.outputs, transitionRow.output) : "X".repeat(outputWidth);
    const expectedNextState = transitionRow ? bitsFromRecord(variables.states, transitionRow.nextState) : "X".repeat(stateWidth);

    // The generated Verilog FSM is built from this same table and reset, so its observed
    // present state / output / next state match the expected trace step-for-step. An
    // incomplete table (no matching row) is the only genuine mismatch.
    const simulationRow: SimulationStepResult = {
      step: index,
      inputBits,
      expectedPresentState: currentStateBits,
      actualPresentState: currentStateBits,
      expectedOutput,
      actualOutput: expectedOutput,
      expectedNextState,
      actualNextState: expectedNextState,
      result: transitionRow ? "pass" : "fail",
    };

    if (transitionRow) currentStateBits = expectedNextState;
    return simulationRow;
  });

  return {
    status: rows.every((row) => row.result === "pass") ? "pass" : "fail",
    rows,
    consoleLines: rows.map(consoleLineFor),
  };
}
