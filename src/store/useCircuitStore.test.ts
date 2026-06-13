import { beforeEach, describe, expect, it } from "vitest";
import { layoutCircuitGraph } from "../logic/circuitLayout";
import { buildDefaultInputSequence, generateTimingData } from "../logic/timing";
import type { LogicValue, StateTableRow } from "../types";
import { useCircuitStore } from "./useCircuitStore";

async function resetStoreToStableMealyD() {
  useCircuitStore.getState().setModelType("mealy");
  useCircuitStore.getState().setFlipFlopType("d");
  useCircuitStore.getState().setVariables({ inputs: ["X"], outputs: ["Z"] });

  for (const row of useCircuitStore.getState().stateTable) {
    useCircuitStore.getState().updateRow(row.id, {
      nextState: {
        ...row.currentState,
      },
      output: {
        Z: row.input.X,
      },
    });
  }

  useCircuitStore.getState().setGeneratedCircuitGraph(null);
  useCircuitStore.getState().setTimingTrace(null);
  await useCircuitStore.getState().recompute();
}

function checkByName(name: string) {
  const check = useCircuitStore.getState().verification.checks.find((item) => item.name === name);
  if (!check) throw new Error(`Missing verification check: ${name}`);
  return check;
}

function expectCheckedPass(name: string) {
  const check = checkByName(name);
  expect(check.skipped).toBeUndefined();
  expect(check.passed).toBe(true);
}

async function generateCircuitIntoStore() {
  const graph = layoutCircuitGraph(useCircuitStore.getState().circuitGraph);
  useCircuitStore.getState().setGeneratedCircuitGraph(graph);
  await useCircuitStore.getState().recompute();
  return graph;
}

async function generateTimingIntoStore() {
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

function flipFirstStateBit(row: StateTableRow) {
  const firstState = useCircuitStore.getState().variables.states[0];
  const nextState: Record<string, LogicValue> = {
    ...row.nextState,
    [firstState]: row.nextState[firstState] === "1" ? "0" : "1",
  };
  return nextState;
}

describe("useCircuitStore verification integration", () => {
  beforeEach(async () => {
    await resetStoreToStableMealyD();
  });

  it("recomputes verification and clears generated artifacts after state table edits", async () => {
    await generateCircuitIntoStore();
    await generateTimingIntoStore();

    expectCheckedPass("Circuit graph check");
    expectCheckedPass("Timing trace check");
    const previousVerification = useCircuitStore.getState().verification;
    const row = useCircuitStore.getState().stateTable[0];

    useCircuitStore.getState().updateRow(row.id, {
      nextState: flipFirstStateBit(row),
    });

    expect(useCircuitStore.getState().verification).not.toBe(previousVerification);
    expect(useCircuitStore.getState().generatedCircuitGraph).toBeNull();
    expect(useCircuitStore.getState().timingTrace).toBeNull();
    expect(checkByName("Circuit graph check")).toMatchObject({ skipped: true, passed: false });
    expect(checkByName("Timing trace check")).toMatchObject({ skipped: true, passed: false });
  });

  it("includes circuit graph validation after a generated circuit is stored", async () => {
    const graph = await generateCircuitIntoStore();

    expect(useCircuitStore.getState().generatedCircuitGraph).toBe(graph);
    expectCheckedPass("Circuit graph check");
  });

  it("includes timing validation after generated timing steps are stored", async () => {
    const steps = await generateTimingIntoStore();

    expect(useCircuitStore.getState().timingTrace).toBe(steps);
    expectCheckedPass("Timing trace check");
  });

  it("keeps missing timing trace marked as skipped instead of passed", () => {
    expect(useCircuitStore.getState().timingTrace).toBeNull();
    expect(checkByName("Timing trace check")).toMatchObject({ skipped: true, passed: false });
  });
});
