import type { Bit, LogicValue, ModelType, StateTableRow, Variables } from "../types";

export type LintSeverity = "error" | "warning" | "info";

export interface LintIssue {
  severity: LintSeverity;
  code: string;
  message: string;
}

export interface DesignLintResult {
  issues: LintIssue[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export interface DesignLintInput {
  stateTable: StateTableRow[];
  variables: Variables;
  modelType: ModelType;
  initialStateBits: string;
}

function isBit(value: LogicValue | undefined): value is Bit {
  return value === "0" || value === "1";
}

function bitsOf(record: Record<string, LogicValue>, names: string[]) {
  return names.map((name) => record[name] ?? "-").join("");
}

function stateLabel(bits: string) {
  return `state ${bits}`;
}

export function lintDesign({ stateTable, variables, modelType, initialStateBits }: DesignLintInput): DesignLintResult {
  const issues: LintIssue[] = [];
  const { states, inputs, outputs } = variables;

  // Variable definition checks
  if (!inputs.length) issues.push({ severity: "error", code: "no-inputs", message: "At least one input variable is required." });
  if (!outputs.length) issues.push({ severity: "error", code: "no-outputs", message: "At least one output variable is required." });
  const allNames = [...states, ...inputs, ...outputs];
  const duplicateNames = allNames.filter((name, index) => allNames.indexOf(name) !== index);
  for (const name of new Set(duplicateNames)) {
    issues.push({
      severity: "error",
      code: "duplicate-variable",
      message: `Variable name "${name}" is used by more than one of state/input/output.`,
    });
  }

  if (initialStateBits.length !== states.length || ![...initialStateBits].every((bit) => bit === "0" || bit === "1")) {
    issues.push({
      severity: "error",
      code: "invalid-initial-state",
      message: `Initial state "${initialStateBits}" does not match the ${states.length}-bit state encoding.`,
    });
  }

  // Row-level checks
  const expectedRowCount = 2 ** states.length * 2 ** inputs.length;
  if (stateTable.length !== expectedRowCount) {
    issues.push({
      severity: "error",
      code: "row-count",
      message: `State table has ${stateTable.length} rows but ${expectedRowCount} are expected for ${states.length} state bit(s) and ${inputs.length} input(s).`,
    });
  }

  const seenRowKeys = new Set<string>();
  const incompleteNext: string[] = [];
  const incompleteOutput: string[] = [];
  for (const row of stateTable) {
    const presentBits = bitsOf(row.currentState, states);
    const inputBits = bitsOf(row.input, inputs);
    const rowKey = `${presentBits}|${inputBits}`;
    if (seenRowKeys.has(rowKey)) {
      issues.push({
        severity: "error",
        code: "duplicate-transition",
        message: `Duplicate transition row for ${stateLabel(presentBits)} with input ${inputBits}.`,
      });
    }
    seenRowKeys.add(rowKey);

    if (!states.every((name) => isBit(row.nextState[name]))) {
      incompleteNext.push(`${presentBits}/X=${inputBits}`);
    }
    if (!outputs.every((name) => row.output[name] === "0" || row.output[name] === "1")) {
      incompleteOutput.push(`${presentBits}/X=${inputBits}`);
    }
  }

  if (incompleteNext.length) {
    issues.push({
      severity: "warning",
      code: "dontcare-next-state",
      message: `Next state uses don't-care (-) at: ${incompleteNext.join(", ")}. Equations still minimize, but state/timing diagrams need fully specified transitions.`,
    });
  }
  if (incompleteOutput.length) {
    issues.push({
      severity: "warning",
      code: "dontcare-output",
      message: `Output uses don't-care (-) at: ${incompleteOutput.join(", ")}. Timing simulation needs fully specified outputs.`,
    });
  }

  // Moore consistency: all rows of the same present state must share outputs
  if (modelType === "moore") {
    const outputsByState = new Map<string, string>();
    for (const row of stateTable) {
      const presentBits = bitsOf(row.currentState, states);
      const outputBits = bitsOf(row.output, outputs);
      const existing = outputsByState.get(presentBits);
      if (existing === undefined) {
        outputsByState.set(presentBits, outputBits);
      } else if (existing !== outputBits) {
        issues.push({
          severity: "error",
          code: "moore-output-conflict",
          message: `Moore model violation: ${stateLabel(presentBits)} has different outputs (${existing} vs ${outputBits}) on different rows.`,
        });
      }
    }
  }

  // Reachability (only meaningful when transitions are fully specified)
  const transitionsByState = new Map<string, string[]>();
  let hasIncompleteTransitions = incompleteNext.length > 0;
  for (const row of stateTable) {
    const presentBits = bitsOf(row.currentState, states);
    const nextBits = bitsOf(row.nextState, states);
    if (![...nextBits].every((bit) => bit === "0" || bit === "1")) {
      hasIncompleteTransitions = true;
      continue;
    }
    const targets = transitionsByState.get(presentBits) ?? [];
    targets.push(nextBits);
    transitionsByState.set(presentBits, targets);
  }

  const allStates = [...new Set(stateTable.map((row) => bitsOf(row.currentState, states)))];
  if (!hasIncompleteTransitions && allStates.length && initialStateBits.length === states.length) {
    const reachable = new Set<string>([initialStateBits]);
    const queue = [initialStateBits];
    while (queue.length) {
      const current = queue.shift() as string;
      for (const target of transitionsByState.get(current) ?? []) {
        if (!reachable.has(target)) {
          reachable.add(target);
          queue.push(target);
        }
      }
    }
    const unreachable = allStates.filter((bits) => !reachable.has(bits));
    if (unreachable.length) {
      issues.push({
        severity: "info",
        code: "unreachable-state",
        message: `Unreachable from initial state ${initialStateBits}: ${unreachable.map(stateLabel).join(", ")}. These rows only matter as don't-cares.`,
      });
    }

    for (const bits of allStates) {
      const targets = transitionsByState.get(bits) ?? [];
      if (targets.length && targets.every((target) => target === bits) && reachable.has(bits) && bits !== initialStateBits) {
        issues.push({
          severity: "info",
          code: "trap-state",
          message: `${stateLabel(bits)} is a trap state: every transition returns to itself.`,
        });
      }
    }

    const targeted = new Set(allStates.flatMap((bits) => transitionsByState.get(bits) ?? []));
    const neverEntered = allStates.filter((bits) => !targeted.has(bits) && bits !== initialStateBits);
    if (neverEntered.length) {
      issues.push({
        severity: "info",
        code: "no-incoming",
        message: `No transitions lead into: ${neverEntered.map(stateLabel).join(", ")}.`,
      });
    }
  }

  return {
    issues,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    infoCount: issues.filter((issue) => issue.severity === "info").length,
  };
}
