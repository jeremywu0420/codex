import { create } from "zustand";
import type { Bit, CircuitGraph, Equation, FlipFlopType, KMapModel, LogicValue, ModelType, StateTableRow, Variables } from "../types";
import { buildCircuitGraph } from "../logic/circuitGraph";
import { deriveSequentialPipeline } from "../logic/equations";
import { buildKMap } from "../logic/kmap";
import type { TimingStep } from "../logic/timing";
import { verifyAllResults } from "../lib/verification";
import type { VerificationResult } from "../lib/verification";
import { lintDesign } from "../lib/designLint";
import type { DesignLintResult } from "../lib/designLint";
import { exampleToStateTable, findExample } from "../examples";

const WORKSPACE_STORAGE_KEY = "scs-workspace-v1";
const HISTORY_LIMIT = 50;

interface WorkspaceSnapshot {
  modelType: ModelType;
  flipFlopType: FlipFlopType;
  variables: Variables;
  stateTable: StateTableRow[];
  initialStateBits: string;
}

interface CircuitState extends WorkspaceSnapshot {
  nextStateEquations: Equation[];
  excitationEquations: Equation[];
  outputEquations: Equation[];
  equations: Equation[];
  kMaps: KMapModel[];
  circuitGraph: CircuitGraph;
  generatedCircuitGraph: CircuitGraph | null;
  timingTrace: TimingStep[] | null;
  verification: VerificationResult;
  lint: DesignLintResult;
  history: WorkspaceSnapshot[];
  future: WorkspaceSnapshot[];
  setModelType: (modelType: ModelType) => void;
  setFlipFlopType: (flipFlopType: FlipFlopType) => void;
  setVariables: (patch: Partial<Pick<Variables, "inputs" | "outputs">>) => void;
  setInitialState: (initialStateBits: string) => void;
  updateRow: (rowId: string, patch: Partial<StateTableRow>) => void;
  updateMooreOutput: (rowId: string, outputName: string, value: LogicValue) => void;
  loadExample: (exampleId: string) => void;
  clearTable: () => void;
  resetAll: () => void;
  undo: () => void;
  redo: () => void;
  setGeneratedCircuitGraph: (generatedCircuitGraph: CircuitGraph | null) => void;
  setTimingTrace: (timingTrace: TimingStep[] | null) => void;
  recompute: () => void;
}

const initialVariables: Variables = {
  inputs: ["X"],
  states: ["A", "B"],
  outputs: ["Z"],
  clock: "CLK",
};

const initialRows: StateTableRow[] = [
  {
    id: "s00-x0",
    currentState: { A: "0", B: "0" },
    input: { X: "0" },
    nextState: { A: "0", B: "1" },
    output: { Z: "0" },
  },
  {
    id: "s00-x1",
    currentState: { A: "0", B: "0" },
    input: { X: "1" },
    nextState: { A: "1", B: "0" },
    output: { Z: "0" },
  },
  {
    id: "s01-x0",
    currentState: { A: "0", B: "1" },
    input: { X: "0" },
    nextState: { A: "1", B: "0" },
    output: { Z: "0" },
  },
  {
    id: "s01-x1",
    currentState: { A: "0", B: "1" },
    input: { X: "1" },
    nextState: { A: "1", B: "1" },
    output: { Z: "1" },
  },
  {
    id: "s10-x0",
    currentState: { A: "1", B: "0" },
    input: { X: "0" },
    nextState: { A: "0", B: "1" },
    output: { Z: "0" },
  },
  {
    id: "s10-x1",
    currentState: { A: "1", B: "0" },
    input: { X: "1" },
    nextState: { A: "1", B: "1" },
    output: { Z: "1" },
  },
  {
    id: "s11-x0",
    currentState: { A: "1", B: "1" },
    input: { X: "0" },
    nextState: { A: "0", B: "0" },
    output: { Z: "1" },
  },
  {
    id: "s11-x1",
    currentState: { A: "1", B: "1" },
    input: { X: "1" },
    nextState: { A: "0", B: "1" },
    output: { Z: "1" },
  },
];

function bitCombinations(names: string[]) {
  const count = 2 ** names.length;
  return Array.from({ length: count }, (_, index) =>
    Object.fromEntries(
      names.map((name, nameIndex) => {
        const shift = names.length - nameIndex - 1;
        const value = ((index >> shift) & 1 ? "1" : "0") as "0" | "1";
        return [name, value];
      }),
    ) as Record<string, "0" | "1">,
  );
}

function rowKey(row: Pick<StateTableRow, "currentState" | "input">, variables: Variables) {
  const stateBits = variables.states.map((state) => row.currentState[state] ?? "0").join("");
  const inputBits = variables.inputs.map((input) => row.input[input] ?? "0").join("");
  return `${stateBits}|${inputBits}`;
}

function copyBits(names: string[], source: Record<string, Bit> | undefined, fallback?: Record<string, Bit>) {
  return Object.fromEntries(names.map((name) => [name, source?.[name] ?? fallback?.[name] ?? "0"])) as Record<string, Bit>;
}

function copyLogicValues(names: string[], source: Record<string, LogicValue> | undefined, fallback?: Record<string, LogicValue>) {
  return Object.fromEntries(names.map((name) => [name, source?.[name] ?? fallback?.[name] ?? "0"])) as Record<string, LogicValue>;
}

function buildStateTable(variables: Variables, existingRows: StateTableRow[] = [], previousVariables: Variables = variables): StateTableRow[] {
  const existingByKey = new Map(existingRows.map((row) => [rowKey(row, previousVariables), row]));
  const stateAssignments = bitCombinations(variables.states);
  const inputAssignments = bitCombinations(variables.inputs);

  return stateAssignments.flatMap((currentState) =>
    inputAssignments.map((input) => {
      const lookupRow = {
        currentState: copyBits(previousVariables.states, currentState),
        input: copyBits(previousVariables.inputs, input),
      };
      const existing = existingByKey.get(rowKey(lookupRow, previousVariables));
      const stateBits = variables.states.map((state) => currentState[state]).join("");
      const inputBits = variables.inputs.map((name) => input[name]).join("");
      return {
        id: `s${stateBits}-x${inputBits || "0"}`,
        currentState,
        input,
        nextState: copyLogicValues(variables.states, existing?.nextState, currentState),
        output: copyLogicValues(variables.outputs, existing?.output),
      };
    }),
  );
}

function stateKey(row: Pick<StateTableRow, "currentState">, variables: Variables) {
  return variables.states.map((state) => row.currentState[state] ?? "0").join("");
}

function normalizeMooreOutputs(stateTable: StateTableRow[], variables: Variables) {
  const outputByState = new Map<string, Record<string, LogicValue>>();
  for (const row of stateTable) {
    const key = stateKey(row, variables);
    if (!outputByState.has(key)) outputByState.set(key, copyLogicValues(variables.outputs, row.output));
  }

  return stateTable.map((row) => ({
    ...row,
    output: copyLogicValues(variables.outputs, outputByState.get(stateKey(row, variables))),
  }));
}

function buildVerification(
  modelType: ModelType,
  flipFlopType: FlipFlopType,
  variables: Variables,
  stateTable: StateTableRow[],
  nextStateEquations: Equation[],
  excitationEquations: Equation[],
  outputEquations: Equation[],
  timingTrace: TimingStep[] | null,
  generatedCircuitGraph: CircuitGraph | null,
) {
  return verifyAllResults({
    stateTable,
    modelType,
    flipFlopType,
    variables,
    nextStateEquations,
    excitationEquations,
    outputEquations,
    timingTrace,
    circuitGraph: generatedCircuitGraph,
  });
}

function compute(
  modelType: ModelType,
  flipFlopType: FlipFlopType,
  variables: Variables,
  stateTable: StateTableRow[],
  initialStateBits: string,
  timingTrace: TimingStep[] | null = null,
  generatedCircuitGraph: CircuitGraph | null = null,
) {
  const pipeline = deriveSequentialPipeline(stateTable, variables, modelType, flipFlopType);
  const equations = pipeline.circuitEquations;
  const kMaps = equations.map(buildKMap);
  const circuitGraph = buildCircuitGraph({ equations, flipFlopType, variables });
  const verification = buildVerification(
    modelType,
    flipFlopType,
    variables,
    stateTable,
    pipeline.nextStateEquations,
    pipeline.excitationEquations,
    pipeline.outputEquations,
    timingTrace,
    generatedCircuitGraph,
  );
  const lint = lintDesign({ stateTable, variables, modelType, initialStateBits });
  return {
    nextStateEquations: pipeline.nextStateEquations,
    excitationEquations: pipeline.excitationEquations,
    outputEquations: pipeline.outputEquations,
    equations,
    kMaps,
    circuitGraph,
    generatedCircuitGraph,
    timingTrace,
    verification,
    lint,
  };
}

function defaultInitialStateBits(variables: Variables) {
  return "0".repeat(variables.states.length);
}

function snapshotOf(state: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    modelType: state.modelType,
    flipFlopType: state.flipFlopType,
    variables: state.variables,
    stateTable: state.stateTable,
    initialStateBits: state.initialStateBits,
  };
}

function saveWorkspace(snapshot: WorkspaceSnapshot) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota/security errors must never break the app.
  }
}

function loadWorkspace(): WorkspaceSnapshot | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkspaceSnapshot>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.modelType !== "mealy" && parsed.modelType !== "moore") return null;
    if (!parsed.flipFlopType || !["jk", "t", "sr", "d"].includes(parsed.flipFlopType)) return null;
    if (!parsed.variables || !Array.isArray(parsed.variables.inputs) || !Array.isArray(parsed.variables.outputs)) return null;
    if (!Array.isArray(parsed.stateTable)) return null;
    const variables: Variables = {
      inputs: parsed.variables.inputs.filter((name): name is string => typeof name === "string" && /^[A-Za-z][A-Za-z0-9]*$/.test(name)),
      states: initialVariables.states,
      outputs: parsed.variables.outputs.filter((name): name is string => typeof name === "string" && /^[A-Za-z][A-Za-z0-9]*$/.test(name)),
      clock: initialVariables.clock,
    };
    if (!variables.inputs.length || !variables.outputs.length) return null;
    const stateTable = buildStateTable(variables, parsed.stateTable as StateTableRow[], variables);
    const initialStateBits =
      typeof parsed.initialStateBits === "string" && /^[01]+$/.test(parsed.initialStateBits) && parsed.initialStateBits.length === variables.states.length
        ? parsed.initialStateBits
        : defaultInitialStateBits(variables);
    return { modelType: parsed.modelType, flipFlopType: parsed.flipFlopType, variables, stateTable, initialStateBits };
  } catch {
    return null;
  }
}

function clearWorkspaceStorage() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

const factorySnapshot: WorkspaceSnapshot = {
  modelType: "mealy",
  flipFlopType: "jk",
  variables: initialVariables,
  stateTable: buildStateTable(initialVariables, initialRows, initialVariables),
  initialStateBits: defaultInitialStateBits(initialVariables),
};

const startupSnapshot = loadWorkspace() ?? factorySnapshot;
const initialComputed = compute(
  startupSnapshot.modelType,
  startupSnapshot.flipFlopType,
  startupSnapshot.variables,
  startupSnapshot.stateTable,
  startupSnapshot.initialStateBits,
);

export const useCircuitStore = create<CircuitState>((set, get) => {
  function pushHistory() {
    const history = [...get().history, snapshotOf(get())].slice(-HISTORY_LIMIT);
    return { history, future: [] as WorkspaceSnapshot[] };
  }

  function applySnapshot(snapshot: WorkspaceSnapshot, historyPatch: Pick<CircuitState, "history" | "future">) {
    const next = compute(snapshot.modelType, snapshot.flipFlopType, snapshot.variables, snapshot.stateTable, snapshot.initialStateBits);
    set({ ...snapshot, ...next, ...historyPatch });
    saveWorkspace(snapshot);
  }

  function commit(snapshot: WorkspaceSnapshot) {
    applySnapshot(snapshot, pushHistory() as Pick<CircuitState, "history" | "future">);
  }

  return {
    ...startupSnapshot,
    ...initialComputed,
    history: [],
    future: [],
    setModelType: (modelType) => {
      const stateTable = modelType === "moore" ? normalizeMooreOutputs(get().stateTable, get().variables) : get().stateTable;
      commit({ ...snapshotOf(get()), modelType, stateTable });
    },
    setFlipFlopType: (flipFlopType) => {
      commit({ ...snapshotOf(get()), flipFlopType });
    },
    setVariables: (patch) => {
      const previousVariables = get().variables;
      const variables = { ...previousVariables, ...patch };
      const rebuiltStateTable = buildStateTable(variables, get().stateTable, previousVariables);
      const stateTable = get().modelType === "moore" ? normalizeMooreOutputs(rebuiltStateTable, variables) : rebuiltStateTable;
      commit({ ...snapshotOf(get()), variables, stateTable });
    },
    setInitialState: (initialStateBits) => {
      commit({ ...snapshotOf(get()), initialStateBits });
    },
    updateRow: (rowId, patch) => {
      const stateTable = get().stateTable.map((row) => (row.id === rowId ? { ...row, ...patch } : row));
      commit({ ...snapshotOf(get()), stateTable });
    },
    updateMooreOutput: (rowId, outputName, value) => {
      const sourceRow = get().stateTable.find((row) => row.id === rowId);
      if (!sourceRow) return;

      const sourceStateKey = get().variables.states.map((state) => sourceRow.currentState[state]).join("");
      const stateTable = get().stateTable.map((row) => {
        const rowStateKey = get().variables.states.map((state) => row.currentState[state]).join("");
        if (rowStateKey !== sourceStateKey) return row;
        return {
          ...row,
          output: {
            ...row.output,
            [outputName]: value,
          },
        };
      });
      commit({ ...snapshotOf(get()), stateTable });
    },
    loadExample: (exampleId) => {
      const example = findExample(exampleId);
      if (!example) return;
      const variables: Variables = {
        inputs: example.inputs,
        states: initialVariables.states,
        outputs: example.outputs,
        clock: initialVariables.clock,
      };
      commit({
        modelType: example.modelType,
        flipFlopType: example.flipFlopType,
        variables,
        stateTable: exampleToStateTable(example),
        initialStateBits: example.initialStateBits,
      });
    },
    clearTable: () => {
      const variables = get().variables;
      const stateTable = get().stateTable.map((row) => ({
        ...row,
        nextState: Object.fromEntries(variables.states.map((name) => [name, "-" as LogicValue])) as Record<string, LogicValue>,
        output: Object.fromEntries(variables.outputs.map((name) => [name, "-" as LogicValue])) as Record<string, LogicValue>,
      }));
      commit({ ...snapshotOf(get()), stateTable });
    },
    resetAll: () => {
      clearWorkspaceStorage();
      commit(factorySnapshot);
    },
    undo: () => {
      const { history, future } = get();
      if (!history.length) return;
      const previous = history[history.length - 1];
      applySnapshot(previous, {
        history: history.slice(0, -1),
        future: [snapshotOf(get()), ...future].slice(0, HISTORY_LIMIT),
      });
    },
    redo: () => {
      const { history, future } = get();
      if (!future.length) return;
      const [next, ...rest] = future;
      applySnapshot(next, {
        history: [...history, snapshotOf(get())].slice(-HISTORY_LIMIT),
        future: rest,
      });
    },
    setGeneratedCircuitGraph: (generatedCircuitGraph) => {
      const state = get();
      const verification = buildVerification(
        state.modelType,
        state.flipFlopType,
        state.variables,
        state.stateTable,
        state.nextStateEquations,
        state.excitationEquations,
        state.outputEquations,
        state.timingTrace,
        generatedCircuitGraph,
      );
      set({ generatedCircuitGraph, verification });
    },
    setTimingTrace: (timingTrace) => {
      const state = get();
      const verification = buildVerification(
        state.modelType,
        state.flipFlopType,
        state.variables,
        state.stateTable,
        state.nextStateEquations,
        state.excitationEquations,
        state.outputEquations,
        timingTrace,
        state.generatedCircuitGraph,
      );
      set({ timingTrace, verification });
    },
    recompute: () => {
      const state = get();
      const next = compute(state.modelType, state.flipFlopType, state.variables, state.stateTable, state.initialStateBits);
      set(next);
    },
  };
});
