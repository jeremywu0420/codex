import { beforeEach, describe, expect, it } from "vitest";
import { layoutCircuitGraph } from "./logic/circuitLayout";
import { buildDefaultInputSequence, generateTimingData } from "./logic/timing";
import { useCircuitStore } from "./store/useCircuitStore";
import type { LogicValue, StateTableRow, Variables } from "./types";
import { verifyAllResults } from "./lib/verification";

const variables: Variables = {
  inputs: ["X"],
  states: ["A"],
  outputs: ["Z"],
  clock: "CLK",
};

const dRows: StateTableRow[] = [
  { id: "0-0", currentState: { A: "0" }, input: { X: "0" }, nextState: { A: "0" }, output: { Z: "0" } },
  { id: "0-1", currentState: { A: "0" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "1" } },
  { id: "1-0", currentState: { A: "1" }, input: { X: "0" }, nextState: { A: "0" }, output: { Z: "0" } },
  { id: "1-1", currentState: { A: "1" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "1" } },
];

const jkToggleRows: StateTableRow[] = [
  { id: "0-0", currentState: { A: "0" }, input: { X: "0" }, nextState: { A: "0" }, output: { Z: "0" } },
  { id: "0-1", currentState: { A: "0" }, input: { X: "1" }, nextState: { A: "1" }, output: { Z: "1" } },
  { id: "1-0", currentState: { A: "1" }, input: { X: "0" }, nextState: { A: "1" }, output: { Z: "0" } },
  { id: "1-1", currentState: { A: "1" }, input: { X: "1" }, nextState: { A: "0" }, output: { Z: "1" } },
];

function check(result: ReturnType<typeof verifyAllResults>, name: string) {
  const found = result.checks.find((item) => item.name === name);
  if (!found) throw new Error(`Missing check: ${name}`);
  return found;
}

async function resetStoreToKnownDTable() {
  useCircuitStore.getState().setModelType("mealy");
  useCircuitStore.getState().setFlipFlopType("d");
  useCircuitStore.getState().setVariables({ inputs: ["X"], outputs: ["Z"] });

  for (const row of useCircuitStore.getState().stateTable) {
    useCircuitStore.getState().updateRow(row.id, {
      nextState: { ...row.currentState },
      output: { Z: row.input.X },
    });
  }

  useCircuitStore.getState().setGeneratedCircuitGraph(null);
  useCircuitStore.getState().setTimingTrace(null);
  await useCircuitStore.getState().recompute();
}

function storeCheck(name: string) {
  const found = useCircuitStore.getState().verification.checks.find((item) => item.name === name);
  if (!found) throw new Error(`Missing check: ${name}`);
  return found;
}

async function generateCircuitInStore() {
  const graph = layoutCircuitGraph(useCircuitStore.getState().circuitGraph);
  useCircuitStore.getState().setGeneratedCircuitGraph(graph);
  await useCircuitStore.getState().recompute();
  return graph;
}

async function generateTimingInStore() {
  const state = useCircuitStore.getState();
  const timingData = generateTimingData(
    state.stateTable,
    state.modelType,
    state.flipFlopType,
    state.variables.states,
    state.variables.inputs,
    state.variables.outputs,
    buildDefaultInputSequence(state.variables.inputs, 4),
  );
  useCircuitStore.getState().setTimingTrace(timingData.steps);
  await useCircuitStore.getState().recompute();
  return timingData.steps;
}

function flipFirstNextStateBit(row: StateTableRow) {
  const stateName = useCircuitStore.getState().variables.states[0];
  const nextState: Record<string, LogicValue> = {
    ...row.nextState,
    [stateName]: row.nextState[stateName] === "1" ? "0" : "1",
  };
  return nextState;
}

describe("verification black-box scenarios", () => {
  beforeEach(async () => {
    await resetStoreToKnownDTable();
  });

  it("1. passes a correct D flip-flop state table", () => {
    const result = verifyAllResults({
      stateTable: dRows,
      modelType: "mealy",
      flipFlopType: "d",
      variables,
      excitationEquations: { D_A: "X" },
      outputEquations: { Z: "X" },
    });

    expect(result.passed).toBe(true);
    expect(check(result, "Flip-flop excitation check").passed).toBe(true);
    expect(check(result, "Output equation check").passed).toBe(true);
  });

  it("2. passes a correct JK state table and skips state transition when excitation is authoritative", () => {
    const result = verifyAllResults({
      stateTable: jkToggleRows,
      modelType: "mealy",
      flipFlopType: "jk",
      variables,
      excitationEquations: { J_A: "X", K_A: "X" },
      outputEquations: { Z: "X" },
    });

    expect(result.passed).toBe(true);
    expect(check(result, "Flip-flop excitation check").passed).toBe(true);
    expect(check(result, "State transition check")).toMatchObject({ skipped: true, passed: false });
  });

  it("3. fails when JA is forced to 0 and reports excitation mismatch details", () => {
    const result = verifyAllResults({
      stateTable: jkToggleRows,
      modelType: "mealy",
      flipFlopType: "jk",
      variables,
      excitationEquations: { J_A: "0", K_A: "X" },
      outputEquations: { Z: "X" },
    });
    const mismatch = result.mismatches.find((item) => item.type === "EXCITATION");

    expect(result.passed).toBe(false);
    expect(mismatch).toMatchObject({
      type: "EXCITATION",
      presentState: "0",
      input: "1",
      expectedNextState: "1",
      actualNextState: "0",
    });
    expect(mismatch?.suspectedEquation).toContain("J_A");
  });

  it("4. fails when Z is forced to 0 and reports expected and actual output", () => {
    const result = verifyAllResults({
      stateTable: dRows,
      modelType: "mealy",
      flipFlopType: "d",
      variables,
      excitationEquations: { D_A: "X" },
      outputEquations: { Z: "0" },
    });
    const mismatch = result.mismatches.find((item) => item.type === "OUTPUT");

    expect(result.passed).toBe(false);
    expect(mismatch).toMatchObject({
      type: "OUTPUT",
      expectedOutput: "1",
      actualOutput: "0",
      suspectedEquation: "Z",
    });
  });

  it("5. marks missing timingTrace as skipped, not passed", () => {
    const result = verifyAllResults({
      stateTable: dRows,
      modelType: "mealy",
      flipFlopType: "d",
      variables,
      excitationEquations: { D_A: "X" },
      outputEquations: { Z: "X" },
    });

    expect(check(result, "Timing trace check")).toMatchObject({ skipped: true, passed: false });
  });

  it("6. marks missing circuitGraph as skipped, not passed", () => {
    const result = verifyAllResults({
      stateTable: dRows,
      modelType: "mealy",
      flipFlopType: "d",
      variables,
      excitationEquations: { D_A: "X" },
      outputEquations: { Z: "X" },
    });

    expect(check(result, "Circuit graph check")).toMatchObject({ skipped: true, passed: false });
  });

  it("7. clears generated timing and circuit state after a state-table row edit", async () => {
    await generateCircuitInStore();
    await generateTimingInStore();
    const previousVerification = useCircuitStore.getState().verification;
    const row = useCircuitStore.getState().stateTable[0];

    useCircuitStore.getState().updateRow(row.id, {
      nextState: flipFirstNextStateBit(row),
    });

    expect(useCircuitStore.getState().verification).not.toBe(previousVerification);
    expect(useCircuitStore.getState().generatedCircuitGraph).toBeNull();
    expect(useCircuitStore.getState().timingTrace).toBeNull();
    expect(storeCheck("Circuit graph check")).toMatchObject({ skipped: true, passed: false });
    expect(storeCheck("Timing trace check")).toMatchObject({ skipped: true, passed: false });
  });

  it("8. clears generatedCircuitGraph after a circuit generation failure path", async () => {
    await generateCircuitInStore();
    expect(storeCheck("Circuit graph check").passed).toBe(true);

    useCircuitStore.getState().setGeneratedCircuitGraph(null);

    expect(useCircuitStore.getState().generatedCircuitGraph).toBeNull();
    expect(storeCheck("Circuit graph check")).toMatchObject({ skipped: true, passed: false });
  });

  it("9. clears timingTrace after a timing generation failure path", async () => {
    await generateTimingInStore();
    expect(storeCheck("Timing trace check").passed).toBe(true);

    useCircuitStore.getState().setTimingTrace(null);

    expect(useCircuitStore.getState().timingTrace).toBeNull();
    expect(storeCheck("Timing trace check")).toMatchObject({ skipped: true, passed: false });
  });
});
