import { create } from "zustand";
import type { Bit, CircuitGraph, Equation, FlipFlopType, KMapModel, LogicValue, ModelType, StateTableRow, Variables } from "../types";
import { computeWorkspaceApi } from "../api/workspaceCompute";
import type { WorkspaceComputeResult } from "../api/workspaceCompute";
import type { TimingStep } from "../logic/timing";
import type { VerificationResult } from "../lib/verification";
import type { DesignLintResult } from "../lib/designLint";
import { decodeWorkspaceHash, parseWorkspaceJson, serializeWorkspace } from "../lib/workspace";
import type { WorkspaceSnapshot } from "../lib/workspace";
import { exampleToStateTable, findExample } from "../examples";

const WORKSPACE_STORAGE_KEY = "scs-workspace-v1";
const HISTORY_LIMIT = 50;
// Wait for typing/selection to settle before recomputing validation, so the result
// panels and the validation badge update once on a stable input instead of flickering
// on every keystroke.
const VALIDATION_DEBOUNCE_MS = 400;

/**
 * Lifecycle of the validation/derivation result, surfaced to the UI so it can show a
 * steady status instead of flashing transient errors while the user is still editing.
 * - idle: nothing computed yet
 * - editing: the user just changed the input; the previous stable result is still shown
 * - validating: inputs settled, recompute in flight
 * - valid / invalid: a stable result is available
 */
export type ValidationStatus = "idle" | "editing" | "validating" | "valid" | "invalid";

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
  computeError: string;
  validationStatus: ValidationStatus;
  history: WorkspaceSnapshot[];
  future: WorkspaceSnapshot[];
  setModelType: (modelType: ModelType) => void;
  setFlipFlopType: (flipFlopType: FlipFlopType) => void;
  setVariables: (patch: Partial<Pick<Variables, "inputs" | "outputs">>) => void;
  setInitialState: (initialStateBits: string) => void;
  updateRow: (rowId: string, patch: Partial<StateTableRow>) => void;
  updateMooreOutput: (rowId: string, outputName: string, value: LogicValue) => void;
  loadExample: (exampleId: string) => void;
  importWorkspace: (text: string) => boolean;
  exportWorkspace: () => string;
  clearTable: () => void;
  resetAll: () => void;
  undo: () => void;
  redo: () => void;
  setGeneratedCircuitGraph: (generatedCircuitGraph: CircuitGraph | null) => void;
  setTimingTrace: (timingTrace: TimingStep[] | null) => void;
  recompute: () => Promise<void>;
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

function emptyCircuitGraph(snapshot: WorkspaceSnapshot): CircuitGraph {
  return {
    nodes: [],
    edges: [],
    clockLine: {
      label: snapshot.variables.clock,
      points: [],
      branches: [],
    },
    metadata: {
      width: 0,
      height: 0,
      flipFlopType: snapshot.flipFlopType,
      stateVariables: snapshot.variables.states,
      inputVariables: snapshot.variables.inputs,
      outputVariables: snapshot.variables.outputs,
    },
  };
}

function pendingVerification(): VerificationResult {
  return {
    passed: false,
    checks: [
      { name: "State transition check", passed: false, skipped: true, message: "Waiting for backend workspace compute." },
      { name: "Flip-flop excitation check", passed: false, skipped: true, message: "Waiting for backend workspace compute." },
      { name: "Output equation check", passed: false, skipped: true, message: "Waiting for backend workspace compute." },
      { name: "Timing trace check", passed: false, skipped: true, message: "Waiting for backend workspace compute." },
      { name: "Circuit graph check", passed: false, skipped: true, message: "Waiting for backend workspace compute." },
    ],
    mismatches: [],
    warnings: [],
  };
}

function emptyLint(): DesignLintResult {
  return {
    issues: [],
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
  };
}

function emptyComputed(snapshot: WorkspaceSnapshot, generatedCircuitGraph: CircuitGraph | null = null, timingTrace: TimingStep[] | null = null): WorkspaceComputeResult {
  return {
    nextStateEquations: [],
    excitationEquations: [],
    outputEquations: [],
    equations: [],
    kMaps: [],
    circuitGraph: emptyCircuitGraph(snapshot),
    generatedCircuitGraph,
    timingTrace,
    verification: pendingVerification(),
    lint: emptyLint(),
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
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, serializeWorkspace(snapshot));
  } catch {
    // Quota/security errors must never break the app.
  }
}

/** Rebuilds the state table against the validated variable lists so partial or stale rows degrade to defaults. */
function normalizeSnapshot(raw: WorkspaceSnapshot): WorkspaceSnapshot {
  const variables: Variables = { ...raw.variables, states: initialVariables.states, clock: initialVariables.clock };
  const stateTable = buildStateTable(variables, raw.stateTable, variables);
  const initialStateBits =
    raw.initialStateBits.length === variables.states.length ? raw.initialStateBits : defaultInitialStateBits(variables);
  return { modelType: raw.modelType, flipFlopType: raw.flipFlopType, variables, stateTable, initialStateBits };
}

function loadWorkspaceFromStorage(): WorkspaceSnapshot | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = parseWorkspaceJson(raw);
    return parsed ? normalizeSnapshot(parsed) : null;
  } catch {
    return null;
  }
}

function loadWorkspaceFromShareLink(): WorkspaceSnapshot | null {
  try {
    if (typeof window === "undefined" || !window.location?.hash) return null;
    const parsed = decodeWorkspaceHash(window.location.hash);
    return parsed ? normalizeSnapshot(parsed) : null;
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

// Share links take priority over the autosaved workspace, then factory defaults.
const startupSnapshot = loadWorkspaceFromShareLink() ?? loadWorkspaceFromStorage() ?? factorySnapshot;
const initialComputed = emptyComputed(startupSnapshot);

function statusFromResult(result: WorkspaceComputeResult): ValidationStatus {
  // A compute whose checks are all "skipped" is still pending more user input (a generated
  // circuit / timing trace); treat that as "valid so far" rather than a failure, mirroring
  // the badge logic in App. Only genuine lint errors or a failed (non-pending) verification
  // mark the design invalid; warnings stay valid.
  const verificationPending = !result.verification.passed && result.verification.checks.every((check) => check.skipped);
  const hasError = result.lint.errorCount > 0 || (!verificationPending && !result.verification.passed);
  return hasError ? "invalid" : "valid";
}

export const useCircuitStore = create<CircuitState>((set, get) => {
  let computeRequestId = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingSnapshot: WorkspaceSnapshot | null = null;

  function cancelScheduledDerived() {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    pendingSnapshot = null;
  }

  // Debounce recompute after edits so validation updates once on a settled input.
  function scheduleDerived(snapshot: WorkspaceSnapshot) {
    pendingSnapshot = snapshot;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      const next = pendingSnapshot;
      pendingSnapshot = null;
      if (next) void refreshDerived(next);
    }, VALIDATION_DEBOUNCE_MS);
  }

  async function refreshDerived(
    snapshot: WorkspaceSnapshot,
    generatedCircuitGraph: CircuitGraph | null = null,
    timingTrace: TimingStep[] | null = null,
  ) {
    const requestId = ++computeRequestId;
    // Hold onto the previous stable result; only flip the status so the UI can show
    // "validating" without clearing what is already on screen.
    set({ validationStatus: "validating" });
    try {
      const result = await computeWorkspaceApi({
        ...snapshot,
        generatedCircuitGraph,
        timingTrace,
      });
      if (requestId !== computeRequestId) return;
      set({ ...result, computeError: "", validationStatus: statusFromResult(result) });
    } catch (error) {
      if (requestId !== computeRequestId) return;
      set({ computeError: error instanceof Error ? error.message : "Workspace compute failed.", validationStatus: "invalid" });
    }
  }

  function pushHistory() {
    const history = [...get().history, snapshotOf(get())].slice(-HISTORY_LIMIT);
    return { history, future: [] as WorkspaceSnapshot[] };
  }

  function applySnapshot(snapshot: WorkspaceSnapshot, historyPatch: Pick<CircuitState, "history" | "future">) {
    // Keep the previously computed equations/K-maps/verification/lint on screen while the
    // backend recomputes, so editing the table never blanks the result panels or briefly
    // flashes the validation badge. Only the user-generated artifacts are invalidated here,
    // because they no longer match the edited table and must be regenerated; the race guard
    // in refreshDerived discards any stale response.
    set({ ...snapshot, generatedCircuitGraph: null, timingTrace: null, computeError: "", validationStatus: "editing", ...historyPatch });
    saveWorkspace(snapshot);
    scheduleDerived(snapshot);
  }

  function commit(snapshot: WorkspaceSnapshot) {
    applySnapshot(snapshot, pushHistory() as Pick<CircuitState, "history" | "future">);
  }

  return {
    ...startupSnapshot,
    ...initialComputed,
    computeError: "",
    validationStatus: "validating",
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
    importWorkspace: (text) => {
      const parsed = parseWorkspaceJson(text);
      if (!parsed) return false;
      commit(normalizeSnapshot(parsed));
      return true;
    },
    exportWorkspace: () => serializeWorkspace(snapshotOf(get())),
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
      // Keep the prior verification visible until the recompute lands so the validation
      // badge does not flash while the new circuit graph is folded into the checks.
      cancelScheduledDerived();
      set({ generatedCircuitGraph, computeError: "" });
      void refreshDerived(snapshotOf(state), generatedCircuitGraph, state.timingTrace);
    },
    setTimingTrace: (timingTrace) => {
      const state = get();
      cancelScheduledDerived();
      set({ timingTrace, computeError: "" });
      void refreshDerived(snapshotOf(state), state.generatedCircuitGraph, timingTrace);
    },
    recompute: async () => {
      const state = get();
      // Run immediately and drop any pending debounced recompute so callers that await
      // recompute() (tests, programmatic refresh) get a deterministic, settled result.
      cancelScheduledDerived();
      await refreshDerived(snapshotOf(state), state.generatedCircuitGraph, state.timingTrace);
    },
  };
});

void useCircuitStore.getState().recompute();
