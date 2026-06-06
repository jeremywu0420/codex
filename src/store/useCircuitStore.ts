import { create } from "zustand";
import type { Bit, CircuitGraph, Equation, FlipFlopType, KMapModel, LogicValue, ModelType, StateTableRow, Variables } from "../types";
import { buildCircuitGraph } from "../logic/circuitGraph";
import { deriveEquations } from "../logic/equations";
import { buildKMap } from "../logic/kmap";

interface CircuitState {
  modelType: ModelType;
  flipFlopType: FlipFlopType;
  variables: Variables;
  stateTable: StateTableRow[];
  equations: Equation[];
  kMaps: KMapModel[];
  circuitGraph: CircuitGraph;
  setModelType: (modelType: ModelType) => void;
  setFlipFlopType: (flipFlopType: FlipFlopType) => void;
  setVariables: (patch: Partial<Pick<Variables, "inputs" | "outputs">>) => void;
  updateRow: (rowId: string, patch: Partial<StateTableRow>) => void;
  updateMooreOutput: (rowId: string, outputName: string, value: LogicValue) => void;
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

function compute(modelType: ModelType, flipFlopType: FlipFlopType, variables: Variables, stateTable: StateTableRow[]) {
  const equations = deriveEquations(stateTable, variables, modelType, flipFlopType);
  const kMaps = equations.map(buildKMap);
  const circuitGraph = buildCircuitGraph({ equations, flipFlopType, variables });
  return { equations, kMaps, circuitGraph };
}

const initialStateTable = buildStateTable(initialVariables, initialRows, initialVariables);
const initialComputed = compute("mealy", "jk", initialVariables, initialStateTable);

export const useCircuitStore = create<CircuitState>((set, get) => ({
  modelType: "mealy",
  flipFlopType: "jk",
  variables: initialVariables,
  stateTable: initialStateTable,
  ...initialComputed,
  setModelType: (modelType) => {
    const stateTable = modelType === "moore" ? normalizeMooreOutputs(get().stateTable, get().variables) : get().stateTable;
    const next = compute(modelType, get().flipFlopType, get().variables, stateTable);
    set({ modelType, stateTable, ...next });
  },
  setFlipFlopType: (flipFlopType) => {
    const next = compute(get().modelType, flipFlopType, get().variables, get().stateTable);
    set({ flipFlopType, ...next });
  },
  setVariables: (patch) => {
    const previousVariables = get().variables;
    const variables = { ...previousVariables, ...patch };
    const rebuiltStateTable = buildStateTable(variables, get().stateTable, previousVariables);
    const stateTable = get().modelType === "moore" ? normalizeMooreOutputs(rebuiltStateTable, variables) : rebuiltStateTable;
    const next = compute(get().modelType, get().flipFlopType, variables, stateTable);
    set({ variables, stateTable, ...next });
  },
  updateRow: (rowId, patch) => {
    const stateTable = get().stateTable.map((row) => (row.id === rowId ? { ...row, ...patch } : row));
    const next = compute(get().modelType, get().flipFlopType, get().variables, stateTable);
    set({ stateTable, ...next });
  },
  updateMooreOutput: (rowId, outputName, value) => {
    const sourceRow = get().stateTable.find((row) => row.id === rowId);
    if (!sourceRow) return;

    const stateKey = get().variables.states.map((state) => sourceRow.currentState[state]).join("");
    const stateTable = get().stateTable.map((row) => {
      const rowStateKey = get().variables.states.map((state) => row.currentState[state]).join("");
      if (rowStateKey !== stateKey) return row;
      return {
        ...row,
        output: {
          ...row.output,
          [outputName]: value,
        },
      };
    });
    const next = compute(get().modelType, get().flipFlopType, get().variables, stateTable);
    set({ stateTable, ...next });
  },
  recompute: () => {
    const next = compute(get().modelType, get().flipFlopType, get().variables, get().stateTable);
    set(next);
  },
}));
