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

function buildNextStateColumns(rows: StateTableRow[], variables: Variables) {
  const variableNames = [...variables.states, ...variables.inputs];
  const columns: Record<string, Record<number, LogicValue>> = {};
  for (const stateName of variables.states) columns[`${stateName}+`] = {};

  for (const row of rows) {
    const minterm = assignmentToIndex(rowToAssignment(row, variableNames), variableNames);
    for (const stateName of variables.states) {
      columns[`${stateName}+`][minterm] = row.nextState[stateName];
    }
  }

  return { variableNames, columns };
}

function deriveOutputEquations(rows: StateTableRow[], variables: Variables, modelType: ModelType) {
  return variables.outputs.map((outputName) => {
    const outputVariables = modelType === "moore" ? variables.states : [...variables.states, ...variables.inputs];
    const column: Record<number, LogicValue> = {};
    for (const row of rows) {
      const assignment = rowToAssignment(row, outputVariables);
      const minterm = assignmentToIndex(assignment, outputVariables);
      if (modelType === "moore" && column[minterm] !== undefined) continue;
      column[minterm] = row.output[outputName];
    }
    return columnToEquation(outputName, outputVariables, column);
  });
}

export function deriveSequentialPipeline(
  rows: StateTableRow[],
  variables: Variables,
  modelType: ModelType,
  flipFlopType: Parameters<typeof buildExcitationColumns>[2],
) {
  const nextState = buildNextStateColumns(rows, variables);
  const nextStateEquations = Object.entries(nextState.columns).map(([label, column]) =>
    columnToEquation(label, nextState.variableNames, column),
  );

  const excitation = buildExcitationColumns(rows, variables, flipFlopType);
  const excitationEquations = Object.entries(excitation.columns).map(([label, column]) =>
    columnToEquation(label, excitation.variableNames, column),
  );

  const outputEquations = deriveOutputEquations(rows, variables, modelType);
  return {
    nextStateEquations,
    excitationEquations,
    outputEquations,
    circuitEquations: [...excitationEquations, ...outputEquations],
  };
}

export function deriveEquations(
  rows: StateTableRow[],
  variables: Variables,
  modelType: ModelType,
  flipFlopType: Parameters<typeof buildExcitationColumns>[2],
): Equation[] {
  return deriveSequentialPipeline(rows, variables, modelType, flipFlopType).circuitEquations;
}
