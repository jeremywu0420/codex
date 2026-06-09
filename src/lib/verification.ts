import type { BooleanAst } from "../logic/booleanParser";
import { parseBooleanEquation } from "../logic/booleanParser";
import { validateCircuitGraph } from "../logic/circuitLayout";
import type { TimingStep } from "../logic/timing";
import type { Bit, CircuitGraph, Equation, FlipFlopType, LogicValue, ModelType, StateTableRow, Variables } from "../types";

export type VerificationMismatchType = "NEXT_STATE" | "OUTPUT" | "EXCITATION" | "TIMING" | "CIRCUIT";

export interface VerificationCheck {
  name: string;
  passed: boolean;
  skipped?: boolean;
  message: string;
}

export interface VerificationMismatch {
  type: VerificationMismatchType;
  presentState?: string;
  input?: string;
  expectedNextState?: string;
  actualNextState?: string;
  expectedOutput?: string;
  actualOutput?: string;
  suspectedEquation?: string;
  message: string;
}

export interface VerificationWarning {
  type: string;
  message: string;
}

export interface VerificationResult {
  passed: boolean;
  checks: VerificationCheck[];
  mismatches: VerificationMismatch[];
  warnings: VerificationWarning[];
}

export type EquationValue = string | string[] | string[][] | Equation;
export type EquationCollection = EquationValue[] | Record<string, EquationValue> | null | undefined;

export interface NormalizedEquation {
  label: string;
  expression: string;
  ast: BooleanAst;
}

export interface VerifyAllResultsInput {
  stateTable: StateTableRow[];
  modelType: ModelType;
  flipFlopType: FlipFlopType;
  variables?: Variables;
  stateEncoding?: Record<string, string>;
  stateBitLabels?: string[];
  inputNames?: string[];
  outputNames?: string[];
  equations?: EquationCollection;
  nextStateEquations?: EquationCollection;
  excitationEquations?: EquationCollection;
  outputEquation?: EquationCollection | EquationValue;
  outputEquations?: EquationCollection;
  timingTrace?: TimingStep[] | null;
  circuitGraph?: CircuitGraph | null;
}

type BooleanContext = Record<string, Bit | boolean | number | string | undefined>;

const ffPinsByType: Record<FlipFlopType, string[]> = {
  jk: ["J", "K"],
  d: ["D"],
  t: ["T"],
  sr: ["S", "R"],
};

function asBit(value: unknown): Bit {
  if (value === "1" || value === 1 || value === true) return "1";
  if (value === "0" || value === 0 || value === false) return "0";
  throw new Error(`Expected boolean bit, got ${String(value)}.`);
}

function expressionFromTerms(value: string[] | string[][]) {
  if (!value.length) return "0";
  if (Array.isArray(value[0])) {
    return (value as string[][]).map((term) => term.join("")).join(" + ");
  }
  return (value as string[]).join(" + ");
}

function normalizeExpression(expression: string) {
  return expression.replace(/~/g, "!").replace(/\u7e5a/g, "*");
}

export function normalizeEquation(label: string, value: EquationValue): NormalizedEquation {
  const equationLabel = typeof value === "object" && !Array.isArray(value) && "label" in value ? value.label : label;
  const expression =
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? expressionFromTerms(value)
        : value.expression;
  const normalizedExpression = normalizeExpression(expression);
  return {
    label: equationLabel,
    expression: normalizedExpression,
    ast: parseBooleanEquation(normalizedExpression),
  };
}

export function normalizeEquations(equations: EquationCollection): Record<string, NormalizedEquation> {
  if (!equations) return {};

  const normalized: Record<string, NormalizedEquation> = {};
  if (Array.isArray(equations)) {
    equations.forEach((value, index) => {
      const fallbackLabel = typeof value === "object" && !Array.isArray(value) && "label" in value ? value.label : `E${index}`;
      const equation = normalizeEquation(fallbackLabel, value);
      normalized[equation.label] = equation;
    });
    return normalized;
  }

  Object.entries(equations).forEach(([label, value]) => {
    const equation = normalizeEquation(label, value);
    normalized[equation.label] = equation;
  });
  return normalized;
}

function isSingleEquationValue(value: EquationCollection | EquationValue): value is EquationValue {
  if (typeof value === "string") return true;
  if (Array.isArray(value)) return value.length === 0 || typeof value[0] === "string" || Array.isArray(value[0]);
  if (!value || typeof value !== "object") return false;
  return "expression" in value;
}

function normalizeOutputEquationInput(
  outputEquation: EquationCollection | EquationValue,
  fallbackOutputName: string,
) {
  if (isSingleEquationValue(outputEquation)) {
    const equation = normalizeEquation(fallbackOutputName, outputEquation);
    return { [equation.label]: equation };
  }
  return normalizeEquations(outputEquation);
}

function valueForName(name: string, context: BooleanContext): Bit {
  const candidates = [name, name.toUpperCase(), name.toLowerCase()];
  for (const candidate of candidates) {
    if (context[candidate] !== undefined) return asBit(context[candidate]);
  }
  throw new Error(`Missing boolean value for ${name}.`);
}

function evaluateAst(ast: BooleanAst, context: BooleanContext): Bit {
  if (ast.type === "CONST") return ast.value;
  if (ast.type === "VAR") return valueForName(ast.name, context);
  if (ast.type === "NOT") return evaluateAst(ast.value, context) === "1" ? "0" : "1";
  if (ast.type === "AND") return ast.terms.every((term) => evaluateAst(term, context) === "1") ? "1" : "0";
  return ast.terms.some((term) => evaluateAst(term, context) === "1") ? "1" : "0";
}

export function evaluateBooleanExpression(expression: string, context: BooleanContext): Bit {
  return evaluateAst(parseBooleanEquation(normalizeExpression(expression)), context);
}

function collectAstVariables(ast: BooleanAst, names = new Set<string>()) {
  if (ast.type === "VAR") names.add(ast.name);
  if (ast.type === "NOT") collectAstVariables(ast.value, names);
  if (ast.type === "AND" || ast.type === "OR") ast.terms.forEach((term) => collectAstVariables(term, names));
  return names;
}

function inferNames(rows: StateTableRow[], section: "currentState" | "input" | "output") {
  const names = new Set<string>();
  rows.forEach((row) => Object.keys(row[section]).forEach((name) => names.add(name)));
  return [...names];
}

function resolveStateNames(input: VerifyAllResultsInput) {
  return input.variables?.states ?? input.stateBitLabels ?? inferNames(input.stateTable, "currentState");
}

function resolveInputNames(input: VerifyAllResultsInput) {
  return input.variables?.inputs ?? input.inputNames ?? inferNames(input.stateTable, "input");
}

function resolveOutputNames(input: VerifyAllResultsInput) {
  return input.variables?.outputs ?? input.outputNames ?? inferNames(input.stateTable, "output");
}

function bitsFor(names: string[], values: Record<string, LogicValue | Bit>) {
  return names.map((name) => values[name] ?? "?").join("");
}

function addContextAliases(context: BooleanContext, name: string, value: Bit) {
  context[name] = value;
  context[name.toUpperCase()] = value;
  context[name.toLowerCase()] = value;
}

function rowToContext(row: StateTableRow, stateNames: string[], inputNames: string[]) {
  const context: BooleanContext = {};
  stateNames.forEach((name) => addContextAliases(context, name, row.currentState[name]));
  inputNames.forEach((name) => addContextAliases(context, name, row.input[name]));
  return context;
}

export function encodingToContext(stateName: string, stateEncoding: Record<string, string>, bitLabels: string[]) {
  const encoded = stateEncoding[stateName];
  if (!encoded) throw new Error(`Missing state encoding for ${stateName}.`);
  if (encoded.length !== bitLabels.length) {
    throw new Error(`State encoding for ${stateName} has ${encoded.length} bit(s), expected ${bitLabels.length}.`);
  }
  return Object.fromEntries(bitLabels.map((label, index) => [label, asBit(encoded[index])])) as Record<string, Bit>;
}

function normalizeLabel(label: string) {
  return label.replace(/\+/g, "PLUS").replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
}

function findEquation(equations: Record<string, NormalizedEquation>, labels: string[]) {
  const byNormalizedLabel = new Map(Object.values(equations).map((equation) => [normalizeLabel(equation.label), equation]));
  for (const label of labels) {
    const equation = byNormalizedLabel.get(normalizeLabel(label));
    if (equation) return equation;
  }
  return undefined;
}

function pickEquations(equations: Record<string, NormalizedEquation>, labelGroups: string[][]) {
  const selected: Record<string, NormalizedEquation> = {};
  labelGroups.forEach((labels) => {
    const equation = findEquation(equations, labels);
    if (equation) selected[equation.label] = equation;
  });
  return selected;
}

function nextStateEquationLabels(stateName: string) {
  return [`${stateName}+`, `${stateName}_next`, `${stateName}Next`, `next_${stateName}`, `NEXT_${stateName}`];
}

function excitationEquationLabels(pin: string, stateName: string) {
  return [`${pin}_${stateName}`, `${pin}${stateName}`];
}

function computeNextBitFromFlipFlop(type: FlipFlopType, q: Bit, inputs: Record<string, Bit>): Bit {
  if (type === "d") return inputs.D;
  if (type === "t") return inputs.T === "1" ? (q === "1" ? "0" : "1") : q;
  if (type === "jk") {
    const j = inputs.J;
    const k = inputs.K;
    if (j === "0" && k === "0") return q;
    if (j === "0" && k === "1") return "0";
    if (j === "1" && k === "0") return "1";
    return q === "1" ? "0" : "1";
  }

  const s = inputs.S;
  const r = inputs.R;
  if (s === "1" && r === "1") throw new Error("Invalid SR input: S=1 and R=1.");
  if (s === "0" && r === "0") return q;
  if (s === "0" && r === "1") return "0";
  return "1";
}

function compareBit(expected: LogicValue | undefined, actual: Bit) {
  return expected === "-" || expected === undefined || expected === actual;
}

function makeCheck(name: string, mismatches: VerificationMismatch[], message: string): VerificationCheck {
  return {
    name,
    passed: mismatches.length === 0,
    message: mismatches.length === 0 ? message : `${mismatches.length} mismatch(es) found.`,
  };
}

function skippedCheck(name: string, message: string): VerificationCheck {
  return { name, passed: false, skipped: true, message };
}

function hasNormalizedEquations(equations: Record<string, NormalizedEquation>) {
  return Object.keys(equations).length > 0;
}

function verifyNextStateEquations(
  rows: StateTableRow[],
  stateNames: string[],
  inputNames: string[],
  equations: Record<string, NormalizedEquation>,
) {
  if (!Object.keys(equations).length) {
    return {
      check: skippedCheck("State transition check", "Skipped because next-state equations are not available."),
      mismatches: [] as VerificationMismatch[],
    };
  }

  const mismatches: VerificationMismatch[] = [];
  const reportedMissing = new Set<string>();
  for (const row of rows) {
    const context = rowToContext(row, stateNames, inputNames);
    for (const stateName of stateNames) {
      const equation = findEquation(equations, nextStateEquationLabels(stateName));
      if (!equation) {
        if (!reportedMissing.has(stateName)) {
          reportedMissing.add(stateName);
          mismatches.push({
            type: "NEXT_STATE",
            suspectedEquation: stateName,
            message: `Missing next-state equation for ${stateName}.`,
          });
        }
        continue;
      }

      try {
        const actual = evaluateAst(equation.ast, context);
        const expected = row.nextState[stateName];
        if (!compareBit(expected, actual)) {
          mismatches.push({
            type: "NEXT_STATE",
            presentState: bitsFor(stateNames, row.currentState),
            input: bitsFor(inputNames, row.input),
            expectedNextState: bitsFor(stateNames, row.nextState),
            actualNextState: stateNames.map((name) => (name === stateName ? actual : row.nextState[name])).join(""),
            suspectedEquation: equation.label,
            message: `${equation.label} evaluated to ${actual}, expected ${expected}.`,
          });
        }
      } catch (error) {
        mismatches.push({
          type: "NEXT_STATE",
          presentState: bitsFor(stateNames, row.currentState),
          input: bitsFor(inputNames, row.input),
          suspectedEquation: equation.label,
          message: error instanceof Error ? error.message : "Next-state equation evaluation failed.",
        });
      }
    }
  }

  return {
    check: makeCheck("State transition check", mismatches, "All next-state equations match the state table."),
    mismatches,
  };
}

function verifyExcitationEquations(
  rows: StateTableRow[],
  stateNames: string[],
  inputNames: string[],
  flipFlopType: FlipFlopType,
  equations: Record<string, NormalizedEquation>,
) {
  if (!Object.keys(equations).length) {
    return {
      check: skippedCheck("Flip-flop excitation check", "Skipped because excitation equations are not available."),
      mismatches: [] as VerificationMismatch[],
    };
  }

  const pins = ffPinsByType[flipFlopType];
  const mismatches: VerificationMismatch[] = [];
  const reportedMissing = new Set<string>();

  for (const row of rows) {
    const context = rowToContext(row, stateNames, inputNames);
    for (const stateName of stateNames) {
      const pinValues: Record<string, Bit> = {};
      const suspectedLabels: string[] = [];

      for (const pin of pins) {
        const equation = findEquation(equations, excitationEquationLabels(pin, stateName));
        if (!equation) {
          const key = `${pin}_${stateName}`;
          if (!reportedMissing.has(key)) {
            reportedMissing.add(key);
            mismatches.push({
              type: "EXCITATION",
              suspectedEquation: key,
              message: `Missing excitation equation for ${key}.`,
            });
          }
          continue;
        }

        try {
          pinValues[pin] = evaluateAst(equation.ast, context);
          suspectedLabels.push(equation.label);
        } catch (error) {
          mismatches.push({
            type: "EXCITATION",
            presentState: bitsFor(stateNames, row.currentState),
            input: bitsFor(inputNames, row.input),
            suspectedEquation: equation.label,
            message: error instanceof Error ? error.message : "Excitation equation evaluation failed.",
          });
        }
      }

      if (pins.some((pin) => !pinValues[pin])) continue;

      try {
        const actual = computeNextBitFromFlipFlop(flipFlopType, row.currentState[stateName], pinValues);
        const expected = row.nextState[stateName];
        if (!compareBit(expected, actual)) {
          mismatches.push({
            type: "EXCITATION",
            presentState: bitsFor(stateNames, row.currentState),
            input: bitsFor(inputNames, row.input),
            expectedNextState: bitsFor(stateNames, row.nextState),
            actualNextState: stateNames.map((name) => (name === stateName ? actual : row.nextState[name])).join(""),
            suspectedEquation: suspectedLabels.join(", "),
            message: `${suspectedLabels.join(", ")} drive ${stateName}+ to ${actual}, expected ${expected}.`,
          });
        }
      } catch (error) {
        mismatches.push({
          type: "EXCITATION",
          presentState: bitsFor(stateNames, row.currentState),
          input: bitsFor(inputNames, row.input),
          expectedNextState: bitsFor(stateNames, row.nextState),
          suspectedEquation: suspectedLabels.join(", "),
          message: error instanceof Error ? error.message : "Flip-flop excitation is invalid.",
        });
      }
    }
  }

  return {
    check: makeCheck("Flip-flop excitation check", mismatches, "All excitation equations reproduce the expected next state."),
    mismatches,
  };
}

function verifyOutputEquations(
  rows: StateTableRow[],
  modelType: ModelType,
  stateNames: string[],
  inputNames: string[],
  outputNames: string[],
  equations: Record<string, NormalizedEquation>,
) {
  if (!outputNames.length) {
    return {
      check: skippedCheck("Output equation check", "Skipped because no output variables are configured."),
      mismatches: [] as VerificationMismatch[],
      warnings: [] as VerificationWarning[],
    };
  }
  if (!Object.keys(equations).length) {
    return {
      check: skippedCheck("Output equation check", "Skipped because output equations are not available."),
      mismatches: [] as VerificationMismatch[],
      warnings: [] as VerificationWarning[],
    };
  }

  const mismatches: VerificationMismatch[] = [];
  const warnings: VerificationWarning[] = [];

  if (modelType === "moore") {
    Object.values(equations).forEach((equation) => {
      const variables = collectAstVariables(equation.ast);
      const inputDependency = inputNames.find((inputName) => variables.has(inputName) || variables.has(inputName.toLowerCase()) || variables.has(inputName.toUpperCase()));
      if (inputDependency) {
        warnings.push({
          type: "MOORE_OUTPUT_INPUT_DEPENDENCY",
          message: `${equation.label} references input ${inputDependency}, but Moore outputs should depend only on present state.`,
        });
      }
    });

    const outputValuesByState = new Map<string, Map<string, Set<LogicValue>>>();
    rows.forEach((row) => {
      const stateKey = bitsFor(stateNames, row.currentState);
      const byOutput = outputValuesByState.get(stateKey) ?? new Map<string, Set<LogicValue>>();
      outputNames.forEach((outputName) => {
        const values = byOutput.get(outputName) ?? new Set<LogicValue>();
        values.add(row.output[outputName]);
        byOutput.set(outputName, values);
      });
      outputValuesByState.set(stateKey, byOutput);
    });

    outputValuesByState.forEach((byOutput, stateKey) => {
      byOutput.forEach((values, outputName) => {
        const concreteValues = [...values].filter((value) => value !== "-");
        if (new Set(concreteValues).size > 1) {
          warnings.push({
            type: "MOORE_OUTPUT_CONFLICT",
            message: `Rows with present state ${stateKey} contain conflicting Moore output values for ${outputName}.`,
          });
        }
      });
    });
  }

  const reportedMissing = new Set<string>();
  for (const row of rows) {
    const context = rowToContext(row, stateNames, inputNames);
    for (const outputName of outputNames) {
      const equation = findEquation(equations, [outputName]);
      if (!equation) {
        if (!reportedMissing.has(outputName)) {
          reportedMissing.add(outputName);
          mismatches.push({
            type: "OUTPUT",
            suspectedEquation: outputName,
            message: `Missing output equation for ${outputName}.`,
          });
        }
        continue;
      }

      try {
        const actual = evaluateAst(equation.ast, context);
        const expected = row.output[outputName];
        if (!compareBit(expected, actual)) {
          mismatches.push({
            type: "OUTPUT",
            presentState: bitsFor(stateNames, row.currentState),
            input: bitsFor(inputNames, row.input),
            expectedOutput: bitsFor(outputNames, row.output),
            actualOutput: outputNames.map((name) => (name === outputName ? actual : row.output[name])).join(""),
            suspectedEquation: equation.label,
            message: `${equation.label} evaluated to ${actual}, expected ${expected}.`,
          });
        }
      } catch (error) {
        mismatches.push({
          type: "OUTPUT",
          presentState: bitsFor(stateNames, row.currentState),
          input: bitsFor(inputNames, row.input),
          suspectedEquation: equation.label,
          message: error instanceof Error ? error.message : "Output equation evaluation failed.",
        });
      }
    }
  }

  return {
    check: makeCheck("Output equation check", mismatches, "All output equations match the state table."),
    mismatches,
    warnings,
  };
}

function rowMatchesStep(row: StateTableRow, step: TimingStep, stateNames: string[], inputNames: string[]) {
  return (
    stateNames.every((stateName) => row.currentState[stateName] === step.currentState[stateName]) &&
    inputNames.every((inputName) => row.input[inputName] === step.input[inputName])
  );
}

function verifyTimingTrace(
  rows: StateTableRow[],
  timingTrace: TimingStep[] | null | undefined,
  stateNames: string[],
  inputNames: string[],
  outputNames: string[],
) {
  if (!timingTrace?.length) {
    return {
      check: skippedCheck("Timing trace check", "Skipped because timing trace is not available."),
      mismatches: [] as VerificationMismatch[],
    };
  }

  const mismatches: VerificationMismatch[] = [];
  timingTrace.forEach((step, index) => {
    const previous = timingTrace[index - 1];
    if (previous) {
      const expectedCurrent = bitsFor(stateNames, previous.nextState);
      const actualCurrent = bitsFor(stateNames, step.currentState);
      if (expectedCurrent !== actualCurrent) {
        mismatches.push({
          type: "TIMING",
          presentState: actualCurrent,
          expectedNextState: expectedCurrent,
          actualNextState: actualCurrent,
          message: `Timing step ${step.step} current state does not match the previous step next state.`,
        });
      }
    }

    const row = rows.find((candidate) => rowMatchesStep(candidate, step, stateNames, inputNames));
    if (!row) {
      mismatches.push({
        type: "TIMING",
        presentState: bitsFor(stateNames, step.currentState),
        input: bitsFor(inputNames, step.input),
        message: `No state table row matches timing step ${step.step}.`,
      });
      return;
    }

    const expectedNextState = bitsFor(stateNames, row.nextState);
    const actualNextState = bitsFor(stateNames, step.nextState);
    stateNames.forEach((stateName) => {
      if (!compareBit(row.nextState[stateName], step.nextState[stateName])) {
        mismatches.push({
          type: "TIMING",
          presentState: bitsFor(stateNames, step.currentState),
          input: bitsFor(inputNames, step.input),
          expectedNextState,
          actualNextState,
          message: `Timing step ${step.step} next state does not match the state table.`,
        });
      }
    });

    const expectedOutput = bitsFor(outputNames, row.output);
    const actualOutput = bitsFor(outputNames, step.output);
    outputNames.forEach((outputName) => {
      if (!compareBit(row.output[outputName], step.output[outputName])) {
        mismatches.push({
          type: "TIMING",
          presentState: bitsFor(stateNames, step.currentState),
          input: bitsFor(inputNames, step.input),
          expectedOutput,
          actualOutput,
          message: `Timing step ${step.step} output does not match the state table.`,
        });
      }
    });
  });

  return {
    check: makeCheck("Timing trace check", mismatches, "Timing trace matches the state table."),
    mismatches,
  };
}

function verifyCircuitGraph(circuitGraph: CircuitGraph | null | undefined) {
  if (!circuitGraph) {
    return {
      check: skippedCheck("Circuit graph check", "Skipped because circuit graph is not available."),
      mismatches: [] as VerificationMismatch[],
    };
  }

  const errors = validateCircuitGraph(circuitGraph);
  const mismatches = errors.map((error) => ({
    type: "CIRCUIT" as const,
    message: error,
  }));
  return {
    check: makeCheck("Circuit graph check", mismatches, "Circuit graph structural validation passed."),
    mismatches,
  };
}

export function verifyAllResults(input: VerifyAllResultsInput): VerificationResult {
  const stateNames = resolveStateNames(input);
  const inputNames = resolveInputNames(input);
  const outputNames = resolveOutputNames(input);
  const suppliedEquations = normalizeEquations(input.equations);
  const explicitNextStateEquations = normalizeEquations(input.nextStateEquations);
  const explicitExcitationEquations = normalizeEquations(input.excitationEquations);
  const explicitOutputEquations = input.outputEquations
    ? normalizeEquations(input.outputEquations)
    : input.outputEquation
      ? normalizeOutputEquationInput(input.outputEquation, outputNames[0] ?? "Z")
      : {};
  const nextStateEquations = Object.keys(explicitNextStateEquations).length
    ? explicitNextStateEquations
    : pickEquations(suppliedEquations, stateNames.map(nextStateEquationLabels));
  const excitationEquations = Object.keys(explicitExcitationEquations).length
    ? explicitExcitationEquations
    : pickEquations(
      suppliedEquations,
      stateNames.flatMap((stateName) => ffPinsByType[input.flipFlopType].map((pin) => excitationEquationLabels(pin, stateName))),
    );
  const outputEquations = Object.keys(explicitOutputEquations).length
    ? explicitOutputEquations
    : pickEquations(suppliedEquations, outputNames.map((outputName) => [outputName]));

  const hasExcitationEquations = hasNormalizedEquations(excitationEquations);
  const nextStateResult = hasExcitationEquations
    ? {
      check: skippedCheck(
        "State transition check",
        "Skipped because excitation equations are available and used as the authoritative flip-flop path.",
      ),
      mismatches: [] as VerificationMismatch[],
    }
    : verifyNextStateEquations(input.stateTable, stateNames, inputNames, nextStateEquations);
  const excitationResult = hasExcitationEquations
    ? verifyExcitationEquations(input.stateTable, stateNames, inputNames, input.flipFlopType, excitationEquations)
    : {
      check: skippedCheck(
        "Flip-flop excitation check",
        "Skipped because excitation equations are not available; next-state equations are used as the fallback.",
      ),
      mismatches: [] as VerificationMismatch[],
    };
  const outputResult = verifyOutputEquations(input.stateTable, input.modelType, stateNames, inputNames, outputNames, outputEquations);
  const timingResult = verifyTimingTrace(input.stateTable, input.timingTrace, stateNames, inputNames, outputNames);
  const circuitResult = verifyCircuitGraph(input.circuitGraph);

  const checks = [nextStateResult.check, excitationResult.check, outputResult.check, timingResult.check, circuitResult.check];
  const mismatches = [
    ...nextStateResult.mismatches,
    ...excitationResult.mismatches,
    ...outputResult.mismatches,
    ...timingResult.mismatches,
    ...circuitResult.mismatches,
  ];
  const warnings = [...outputResult.warnings];

  return {
    passed: checks.every((check) => check.skipped || check.passed) && mismatches.length === 0,
    checks,
    mismatches,
    warnings,
  };
}
