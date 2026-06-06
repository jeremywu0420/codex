import type { Equation, LogicValue, ModelType, StateTableRow, Variables } from "../types";
import { assignmentToIndex, buildExcitationColumns, rowToAssignment } from "./flipFlop";
import { minimizeBoolean } from "./minimizer";

function columnToEquation(label: string, variableNames: string[], column: Record<number, LogicValue>) {
  const minterms = Object.entries(column)
    .filter(([, value]) => value === "1")
    .map(([key]) => Number(key));
  const dontCares = Object.entries(column)
    .filter(([, value]) => value === "-")
    .map(([key]) => Number(key));
  return minimizeBoolean(label, variableNames, minterms, dontCares);
}

export function deriveEquations(
  rows: StateTableRow[],
  variables: Variables,
  modelType: ModelType,
  flipFlopType: Parameters<typeof buildExcitationColumns>[2],
): Equation[] {
  const excitation = buildExcitationColumns(rows, variables, flipFlopType);
  const equations = Object.entries(excitation.columns).map(([label, column]) =>
    columnToEquation(label, excitation.variableNames, column),
  );

  for (const outputName of variables.outputs) {
    const outputVariables = modelType === "moore" ? variables.states : [...variables.states, ...variables.inputs];
    const column: Record<number, LogicValue> = {};
    for (const row of rows) {
      const assignment = rowToAssignment(row, outputVariables);
      const minterm = assignmentToIndex(assignment, outputVariables);
      if (modelType === "moore" && column[minterm] !== undefined) continue;
      column[minterm] = row.output[outputName];
    }
    equations.push(columnToEquation(outputName, outputVariables, column));
  }

  return equations;
}
