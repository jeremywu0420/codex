import type { Bit, FlipFlopType, LogicValue, StateTableRow, Variables } from "../types";

export function excitationFor(type: FlipFlopType, current: Bit, next: LogicValue): LogicValue[] {
  if (next === "-") {
    if (type === "jk" || type === "sr") return ["-", "-"];
    return ["-"];
  }
  if (type === "d") return [next];
  if (type === "t") return [current === next ? "0" : "1"];
  if (type === "jk") {
    if (current === "0" && next === "0") return ["0", "-"];
    if (current === "0" && next === "1") return ["1", "-"];
    if (current === "1" && next === "0") return ["-", "1"];
    return ["-", "0"];
  }
  if (current === "0" && next === "0") return ["0", "-"];
  if (current === "0" && next === "1") return ["1", "0"];
  if (current === "1" && next === "0") return ["0", "1"];
  return ["-", "0"];
}

export function pinLabelsFor(type: FlipFlopType, stateName: string): string[] {
  if (type === "d") return [`D_${stateName}`];
  if (type === "t") return [`T_${stateName}`];
  if (type === "sr") return [`S_${stateName}`, `R_${stateName}`];
  return [`J_${stateName}`, `K_${stateName}`];
}

export function rowToAssignment(row: StateTableRow, variables: string[]): Record<string, Bit> {
  const values: Record<string, Bit> = {};
  for (const name of variables) {
    values[name] = row.currentState[name] ?? row.input[name] ?? "0";
  }
  return values;
}

export function assignmentToIndex(assignment: Record<string, Bit>, variables: string[]): number {
  return variables.reduce((index, name) => (index << 1) + Number(assignment[name] ?? "0"), 0);
}

export function buildExcitationColumns(
  rows: StateTableRow[],
  variables: Variables,
  flipFlopType: FlipFlopType,
) {
  const variableNames = [...variables.states, ...variables.inputs];
  const columns: Record<string, Record<number, LogicValue>> = {};

  for (const stateName of variables.states) {
    for (const label of pinLabelsFor(flipFlopType, stateName)) columns[label] = {};
  }

  for (const row of rows) {
    const minterm = assignmentToIndex(rowToAssignment(row, variableNames), variableNames);
    for (const stateName of variables.states) {
      const labels = pinLabelsFor(flipFlopType, stateName);
      const values = excitationFor(flipFlopType, row.currentState[stateName], row.nextState[stateName]);
      labels.forEach((label, index) => {
        columns[label][minterm] = values[index];
      });
    }
  }

  return { variableNames, columns };
}
