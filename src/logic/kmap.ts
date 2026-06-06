import type { Equation, KMapCell, KMapGroup, KMapModel, LogicValue } from "../types";

function grayOrder(width: number): string[] {
  if (width <= 0) return [""];
  if (width === 1) return ["0", "1"];
  const previous = grayOrder(width - 1);
  return [
    ...previous.map((bits) => `0${bits}`),
    ...[...previous].reverse().map((bits) => `1${bits}`),
  ];
}

function bitsToNumber(bits: string) {
  return Number.parseInt(bits || "0", 2);
}

function cellValue(equation: Equation, minterm: number): LogicValue {
  if (equation.minterms.includes(minterm)) return "1";
  if (equation.dontCares.includes(minterm)) return "-";
  return "0";
}

export function buildKMap(equation: Equation): KMapModel {
  const split = Math.floor(equation.variableNames.length / 2);
  const rowVariables = equation.variableNames.slice(0, split);
  const colVariables = equation.variableNames.slice(split);
  const rowLabels = grayOrder(rowVariables.length);
  const colLabels = grayOrder(colVariables.length);
  const cells: KMapCell[] = [];

  rowLabels.forEach((rowLabel, row) => {
    colLabels.forEach((colLabel, col) => {
      const minterm = bitsToNumber(rowLabel + colLabel);
      cells.push({
        row,
        col,
        label: `${rowLabel || "0"}${colLabel || ""}`,
        minterm,
        value: cellValue(equation, minterm),
      });
    });
  });

  return {
    equationId: equation.id,
    rowVariables,
    colVariables,
    cells,
    groups: groupKMap(equation, cells),
  };
}

export function groupKMap(equation: Equation, cells: KMapCell[]): KMapGroup[] {
  return equation.expression
    .split(" + ")
    .filter((term) => term && term !== "0")
    .map((term, index) => ({
      id: `${equation.id}-group-${index}`,
      term,
      cells: cells.filter((cell) => equation.minterms.includes(cell.minterm)).map((cell) => cell.minterm),
    }));
}
