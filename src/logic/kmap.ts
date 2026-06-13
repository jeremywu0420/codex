import type { Equation, KMapCell, KMapGroup, KMapModel, LogicValue } from "../types";

export function grayOrder(width: number): string[] {
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
    rowLabels,
    colLabels,
    cells,
    groups: groupKMap(equation, cells),
  };
}

/**
 * Checks whether a product term (e.g. "A'BX") covers the cell whose variable
 * assignment is given by `bits` (one bit per name in `variableNames`).
 * Variable names are matched longest-first so multi-character names work.
 */
export function termCoversAssignment(term: string, variableNames: string[], bits: string): boolean {
  if (term === "1") return true;
  const namesByLength = [...variableNames].sort((first, second) => second.length - first.length);
  let position = 0;
  while (position < term.length) {
    const name = namesByLength.find((candidate) => term.startsWith(candidate, position));
    if (!name) return false;
    position += name.length;
    let negated = false;
    if (term[position] === "'") {
      negated = true;
      position += 1;
    }
    const bit = bits[variableNames.indexOf(name)];
    if ((bit === "1") === negated) return false;
  }
  return true;
}

function mintermBits(minterm: number, width: number) {
  return minterm.toString(2).padStart(width, "0");
}

export function groupKMap(equation: Equation, cells: KMapCell[]): KMapGroup[] {
  const width = equation.variableNames.length;
  return equation.expression
    .split(" + ")
    .filter((term) => term && term !== "0")
    .map((term, index) => ({
      id: `${equation.id}-group-${index}`,
      term,
      cells: cells
        .filter((cell) => termCoversAssignment(term, equation.variableNames, mintermBits(cell.minterm, width)))
        .map((cell) => cell.minterm),
    }));
}
