import type { VerificationResult } from "../lib/verification";
import type { BooleanAst } from "./booleanParser";
import { parseBooleanEquation } from "./booleanParser";
import { pinLabelsFor } from "./flipFlop";
import type { TimingStep } from "./timing";
import type { Bit, Equation, FlipFlopType, LogicValue, ModelType, StateTableRow, Variables } from "../types";

export type CodeTabId = "behavioral" | "gate" | "testbench";
export type CodeGeneratorVerificationStatus = "pass" | "fail" | "pending";

export interface CodeGeneratorArtifacts {
  behavioralVerilog: string;
  gateLevelVerilog: string;
  isStateTableComplete: boolean;
  missingDataMessage: string | null;
  testbench: string;
  verificationStatus: CodeGeneratorVerificationStatus;
}

export interface BuildCodeGeneratorInput {
  equations: Equation[];
  flipFlopType: FlipFlopType;
  modelType: ModelType;
  stateTable: StateTableRow[];
  timingTrace: TimingStep[] | null;
  variables: Variables;
  verification: VerificationResult;
}

interface VerilogIdentifiers {
  clock: string;
  debugState: string;
  equationSignals: Record<string, string>;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  reset: string;
  states: Record<string, string>;
}

const missingStateTableMessage = "Please complete the state table before generating Verilog/Testbench.";

const reservedIdentifiers = new Set([
  "always",
  "assign",
  "begin",
  "case",
  "default",
  "else",
  "end",
  "endcase",
  "endmodule",
  "input",
  "integer",
  "module",
  "next_state",
  "output",
  "reg",
  "state",
  "task",
  "wire",
]);

function isBit(value: LogicValue | undefined): value is Bit {
  return value === "0" || value === "1";
}

export function hasCompleteStateTable(rows: StateTableRow[], variables: Variables) {
  if (!rows.length || !variables.states.length || !variables.outputs.length) return false;

  return rows.every(
    (row) =>
      variables.states.every((name) => isBit(row.currentState[name])) &&
      variables.inputs.every((name) => isBit(row.input[name])) &&
      variables.states.every((name) => isBit(row.nextState[name])) &&
      variables.outputs.every((name) => isBit(row.output[name])),
  );
}

function toVerilogIdentifier(name: string, fallback: string) {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/g, "_").replace(/_+/g, "_");
  const withLeading = /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
  const candidate = withLeading || fallback;
  return reservedIdentifiers.has(candidate) ? `${candidate}_sig` : candidate;
}

function makeUniqueIdentifier(baseName: string, used: Set<string>) {
  let candidate = baseName;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${baseName}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function makeIdentifierMap(variables: Variables, flipFlopType: FlipFlopType, equations: Equation[]): VerilogIdentifiers {
  const used = new Set<string>(reservedIdentifiers);
  const states: Record<string, string> = {};
  const inputs: Record<string, string> = {};
  const outputs: Record<string, string> = {};
  const equationSignals: Record<string, string> = {};

  const clock = makeUniqueIdentifier(toVerilogIdentifier(variables.clock || "clk", "clk"), used);
  const reset = makeUniqueIdentifier(toVerilogIdentifier("reset", "reset"), used);
  const debugState = makeUniqueIdentifier(toVerilogIdentifier("debug_state", "debug_state"), used);

  variables.states.forEach((name) => {
    states[name] = makeUniqueIdentifier(toVerilogIdentifier(name, "state_bit"), used);
  });
  variables.inputs.forEach((name) => {
    inputs[name] = makeUniqueIdentifier(toVerilogIdentifier(name, "input_signal"), used);
  });
  variables.outputs.forEach((name) => {
    outputs[name] = makeUniqueIdentifier(toVerilogIdentifier(name, "output_signal"), used);
  });
  const requiredEquationLabels = [
    ...variables.states.flatMap((stateName) => pinLabelsFor(flipFlopType, stateName)),
    ...variables.outputs,
    ...equations.map((equation) => equation.label),
  ];

  requiredEquationLabels.forEach((label) => {
    if (equationSignals[label]) return;
    if (outputs[label]) {
      equationSignals[label] = outputs[label];
      return;
    }
    equationSignals[label] = makeUniqueIdentifier(toVerilogIdentifier(label, "equation_signal"), used);
  });

  return { clock, debugState, equationSignals, inputs, outputs, reset, states };
}

function packedRange(width: number) {
  return width > 1 ? `[${width - 1}:0] ` : "";
}

function binaryLiteral(bits: string) {
  const value = bits.length ? bits : "0";
  return `${value.length}'b${value}`;
}

function bitsFor(names: string[], record: Record<string, LogicValue>) {
  return names.map((name) => (record[name] === "1" ? "1" : "0")).join("");
}

function signalConcat(names: string[], identifiers: Record<string, string>) {
  const signals = names.map((name) => identifiers[name]);
  return signals.length === 1 ? signals[0] : `{${signals.join(", ")}}`;
}

function stateConstantName(bits: string) {
  return `S_${bits || "0"}`;
}

function uniqueStateBits(rows: StateTableRow[], variables: Variables) {
  const seen = new Set<string>();
  const ordered: string[] = [];
  rows.forEach((row) => {
    const bits = bitsFor(variables.states, row.currentState);
    if (seen.has(bits)) return;
    seen.add(bits);
    ordered.push(bits);
  });
  return ordered;
}

function rowsByState(rows: StateTableRow[], variables: Variables) {
  const byState = new Map<string, StateTableRow[]>();
  rows.forEach((row) => {
    const bits = bitsFor(variables.states, row.currentState);
    byState.set(bits, [...(byState.get(bits) ?? []), row]);
  });
  return byState;
}

function normalizeExpressionForParser(expression: string) {
  return expression
    .replace(/~/g, "!")
    .replace(/[·⋅∙]/g, "*");
}

function precedenceOf(ast: BooleanAst) {
  if (ast.type === "OR") return 1;
  if (ast.type === "AND") return 2;
  if (ast.type === "NOT") return 3;
  return 4;
}

function parenthesizeIfNeeded(value: string, child: BooleanAst, parentPrecedence: number) {
  return precedenceOf(child) < parentPrecedence ? `(${value})` : value;
}

function astToVerilog(ast: BooleanAst, identifiers: VerilogIdentifiers, parentPrecedence = 0): string {
  if (ast.type === "CONST") return `1'b${ast.value}`;
  if (ast.type === "VAR") {
    return identifiers.states[ast.name] ?? identifiers.inputs[ast.name] ?? identifiers.outputs[ast.name] ?? toVerilogIdentifier(ast.name, "signal");
  }
  if (ast.type === "NOT") {
    const value = astToVerilog(ast.value, identifiers, precedenceOf(ast));
    const expression = `~${parenthesizeIfNeeded(value, ast.value, precedenceOf(ast))}`;
    return parentPrecedence > precedenceOf(ast) ? `(${expression})` : expression;
  }
  if (ast.type === "AND") {
    const expression = ast.terms.map((term) => astToVerilog(term, identifiers, precedenceOf(ast))).join(" & ");
    return parentPrecedence > precedenceOf(ast) ? `(${expression})` : expression;
  }
  const expression = ast.terms.map((term) => astToVerilog(term, identifiers, precedenceOf(ast))).join(" | ");
  return parentPrecedence > precedenceOf(ast) ? `(${expression})` : expression;
}

export function equationExpressionToVerilog(expression: string, identifiers: VerilogIdentifiers) {
  const ast = parseBooleanEquation(normalizeExpressionForParser(expression));
  return astToVerilog(ast, identifiers);
}

function renderModulePorts(variables: Variables, identifiers: VerilogIdentifiers, outputKind: "reg" | "wire") {
  const lines = [
    `  input wire ${identifiers.clock}`,
    `  input wire ${identifiers.reset}`,
    ...variables.inputs.map((name) => `  input wire ${identifiers.inputs[name]}`),
    ...variables.outputs.map((name) => `  output ${outputKind} ${identifiers.outputs[name]}`),
    `  output wire ${packedRange(variables.states.length)}${identifiers.debugState}`,
  ];

  return lines.map((line, index) => `${line}${index === lines.length - 1 ? "" : ","}`).join("\n");
}

function renderBehavioralNextStateBlock(rows: StateTableRow[], variables: Variables, identifiers: VerilogIdentifiers, modelType: ModelType) {
  const stateBits = uniqueStateBits(rows, variables);
  const groupedRows = rowsByState(rows, variables);
  const outputTarget = signalConcat(variables.outputs, identifiers.outputs);
  const inputTarget = variables.inputs.length ? signalConcat(variables.inputs, identifiers.inputs) : "";
  const zeroOutput = binaryLiteral("0".repeat(variables.outputs.length));
  const resetState = binaryLiteral("0".repeat(variables.states.length));
  const lines = [
    "always @(*) begin",
    "  next_state = state;",
  ];

  if (modelType === "mealy") lines.push(`  ${outputTarget} = ${zeroOutput};`);

  lines.push("  case (state)");
  stateBits.forEach((bits) => {
    const stateRows = groupedRows.get(bits) ?? [];
    lines.push(`    ${stateConstantName(bits)}: begin`);
    if (variables.inputs.length) {
      lines.push(`      case (${inputTarget})`);
      stateRows.forEach((row) => {
        const inputBits = bitsFor(variables.inputs, row.input);
        const nextBits = bitsFor(variables.states, row.nextState);
        lines.push(`        ${binaryLiteral(inputBits)}: begin`);
        lines.push(`          next_state = ${stateConstantName(nextBits)};`);
        if (modelType === "mealy") lines.push(`          ${outputTarget} = ${binaryLiteral(bitsFor(variables.outputs, row.output))};`);
        lines.push("        end");
      });
      lines.push("        default: begin");
      lines.push(`          next_state = ${stateConstantName(resetState.replace(/^\d+'b/, ""))};`);
      lines.push("        end");
      lines.push("      endcase");
    } else if (stateRows[0]) {
      const row = stateRows[0];
      lines.push(`      next_state = ${stateConstantName(bitsFor(variables.states, row.nextState))};`);
      if (modelType === "mealy") lines.push(`      ${outputTarget} = ${binaryLiteral(bitsFor(variables.outputs, row.output))};`);
    }
    lines.push("    end");
  });
  lines.push("    default: begin");
  lines.push(`      next_state = ${stateConstantName("0".repeat(variables.states.length))};`);
  lines.push("    end");
  lines.push("  endcase");
  lines.push("end");

  return lines.join("\n");
}

function renderMooreOutputBlock(rows: StateTableRow[], variables: Variables, identifiers: VerilogIdentifiers) {
  const outputTarget = signalConcat(variables.outputs, identifiers.outputs);
  const zeroOutput = binaryLiteral("0".repeat(variables.outputs.length));
  const stateBits = uniqueStateBits(rows, variables);
  const groupedRows = rowsByState(rows, variables);
  const lines = [
    "always @(*) begin",
    `  ${outputTarget} = ${zeroOutput};`,
    "  case (state)",
  ];

  stateBits.forEach((bits) => {
    const row = groupedRows.get(bits)?.[0];
    if (!row) return;
    lines.push(`    ${stateConstantName(bits)}: ${outputTarget} = ${binaryLiteral(bitsFor(variables.outputs, row.output))};`);
  });

  lines.push("    default: begin");
  lines.push(`      ${outputTarget} = ${zeroOutput};`);
  lines.push("    end");
  lines.push("  endcase");
  lines.push("end");

  return lines.join("\n");
}

function generateBehavioralVerilog(rows: StateTableRow[], variables: Variables, modelType: ModelType, identifiers: VerilogIdentifiers) {
  const stateWidth = variables.states.length;
  const stateBits = uniqueStateBits(rows, variables);
  const stateRange = packedRange(stateWidth);
  const resetBits = binaryLiteral("0".repeat(stateWidth));
  const lines = [
    "module fsm (",
    renderModulePorts(variables, identifiers, "reg"),
    ");",
    "",
    ...stateBits.map((bits) => `localparam ${stateRange}${stateConstantName(bits)} = ${binaryLiteral(bits)};`),
    "",
    `reg ${stateRange}state;`,
    `reg ${stateRange}next_state;`,
    "",
    `assign ${identifiers.debugState} = state;`,
    ...variables.states.map((name, index) => `wire ${identifiers.states[name]} = state[${stateWidth - index - 1}];`),
    "",
    `always @(posedge ${identifiers.clock} or posedge ${identifiers.reset}) begin`,
    `  if (${identifiers.reset}) begin`,
    `    state <= ${resetBits};`,
    "  end else begin",
    "    state <= next_state;",
    "  end",
    "end",
    "",
    renderBehavioralNextStateBlock(rows, variables, identifiers, modelType),
  ];

  if (modelType === "moore") {
    lines.push("", renderMooreOutputBlock(rows, variables, identifiers));
  }

  lines.push("", "endmodule");
  return lines.join("\n");
}

function generateFlipFlopNextExpression(flipFlopType: FlipFlopType, stateName: string, identifiers: VerilogIdentifiers) {
  const q = identifiers.states[stateName];
  const pins = Object.fromEntries(pinLabelsFor(flipFlopType, stateName).map((label) => [label.split("_")[0], identifiers.equationSignals[label]]));

  if (flipFlopType === "d") return pins.D ?? "1'b0";
  if (flipFlopType === "t") return `${pins.T ?? "1'b0"} ^ ${q}`;
  if (flipFlopType === "sr") return `${pins.S ?? "1'b0"} | (~${pins.R ?? "1'b0"} & ${q})`;
  return `(${pins.J ?? "1'b0"} & ~${q}) | (~${pins.K ?? "1'b0"} & ${q})`;
}

function generateGateLevelVerilog(
  equations: Equation[],
  variables: Variables,
  flipFlopType: FlipFlopType,
  identifiers: VerilogIdentifiers,
) {
  const equationByLabel = new Map(equations.map((equation) => [equation.label, equation]));
  const ffInputLabels = variables.states.flatMap((stateName) => pinLabelsFor(flipFlopType, stateName));
  const ffInputWires = ffInputLabels.map((label) => identifiers.equationSignals[label]).filter(Boolean);
  const stateConcat = signalConcat(variables.states, identifiers.states);
  const stateReset = binaryLiteral("0".repeat(variables.states.length));
  const lines = [
    "module fsm (",
    renderModulePorts(variables, identifiers, "wire"),
    ");",
    "",
    ...variables.states.map((name) => `reg ${identifiers.states[name]};`),
    ...ffInputWires.map((name) => `wire ${name};`),
    "",
    `assign ${identifiers.debugState} = ${stateConcat};`,
    "",
  ];

  [...ffInputLabels, ...variables.outputs].forEach((label) => {
    const equation = equationByLabel.get(label);
    const target = identifiers.equationSignals[label] ?? identifiers.outputs[label];
    if (!target) return;
    const expression = equation ? equationExpressionToVerilog(equation.expression, identifiers) : "1'b0";
    const missingComment = equation ? "" : " // Missing simplified equation in Output 1";
    lines.push(`assign ${target} = ${expression};${missingComment}`);
  });

  lines.push(
    "",
    `always @(posedge ${identifiers.clock} or posedge ${identifiers.reset}) begin`,
    `  if (${identifiers.reset}) begin`,
    `    ${stateConcat} <= ${stateReset};`,
    "  end else begin",
    ...variables.states.map((name) => `    ${identifiers.states[name]} <= ${generateFlipFlopNextExpression(flipFlopType, name, identifiers)};`),
    "  end",
    "end",
    "",
    "endmodule",
  );

  return lines.join("\n");
}

function generateTestbench(variables: Variables, identifiers: VerilogIdentifiers, timingTrace: TimingStep[] | null) {
  if (!timingTrace?.length) {
    return [
      "`timescale 1ns/1ps",
      "",
      "// Please generate the Timing Diagram before creating the testbench.",
      "// The testbench uses the current Timing Diagram trace as the canonical input and expected-output source.",
    ].join("\n");
  }

  const stateWidth = variables.states.length;
  const inputWidth = variables.inputs.length;
  const outputWidth = variables.outputs.length;
  const inputTarget = signalConcat(variables.inputs, identifiers.inputs);
  const outputTarget = signalConcat(variables.outputs, identifiers.outputs);
  const portNames = [
    identifiers.clock,
    identifiers.reset,
    ...variables.inputs.map((name) => identifiers.inputs[name]),
    ...variables.outputs.map((name) => identifiers.outputs[name]),
    identifiers.debugState,
  ];
  const lines = [
    "`timescale 1ns/1ps",
    "",
    "module tb_fsm;",
    "",
    `reg ${identifiers.clock};`,
    `reg ${identifiers.reset};`,
    ...variables.inputs.map((name) => `reg ${identifiers.inputs[name]};`),
    ...variables.outputs.map((name) => `wire ${identifiers.outputs[name]};`),
    `wire ${packedRange(stateWidth)}${identifiers.debugState};`,
    "",
    "fsm dut (",
    ...portNames.map((name, index) => `  .${name}(${name})${index === portNames.length - 1 ? "" : ","}`),
    ");",
    "",
    `always #5 ${identifiers.clock} = ~${identifiers.clock};`,
    "",
    "task run_step;",
    "  input integer step;",
    `  input [${inputWidth - 1}:0] input_value;`,
    `  input [${outputWidth - 1}:0] expected_z;`,
    `  input [${stateWidth - 1}:0] expected_present_state;`,
    `  input [${stateWidth - 1}:0] expected_next_state;`,
    "  integer step_failed;",
    "  begin",
    "    step_failed = 0;",
    `    ${inputTarget} = input_value;`,
    "    #1;",
    `    if (${identifiers.debugState} !== expected_present_state) begin`,
    "      step_failed = 1;",
    `      $display("FAIL step %0d: expected state=%b, got state=%b", step, expected_present_state, ${identifiers.debugState});`,
    "    end",
    `    if (${outputTarget} !== expected_z) begin`,
    "      step_failed = 1;",
    `      $display("FAIL step %0d: expected z=%b, got z=%b", step, expected_z, ${outputTarget});`,
    "    end",
    `    @(posedge ${identifiers.clock});`,
    "    #1;",
    `    if (${identifiers.debugState} !== expected_next_state) begin`,
    "      step_failed = 1;",
    `      $display("FAIL step %0d: expected state=%b, got state=%b", step, expected_next_state, ${identifiers.debugState});`,
    "    end",
    "    if (!step_failed) begin",
    "      $display(\"PASS step %0d\", step);",
    "    end",
    "  end",
    "endtask",
    "",
    "initial begin",
    `  ${identifiers.clock} = 1'b0;`,
    `  ${identifiers.reset} = 1'b1;`,
    ...variables.inputs.map((name) => `  ${identifiers.inputs[name]} = 1'b0;`),
    "  #10;",
    `  ${identifiers.reset} = 1'b0;`,
    "",
    ...timingTrace.map((step) => {
      const inputBits = bitsFor(variables.inputs, step.input);
      const outputBits = bitsFor(variables.outputs, step.output);
      const presentBits = bitsFor(variables.states, step.currentState);
      const nextBits = bitsFor(variables.states, step.nextState);
      return `  run_step(${step.step}, ${binaryLiteral(inputBits)}, ${binaryLiteral(outputBits)}, ${binaryLiteral(presentBits)}, ${binaryLiteral(nextBits)});`;
    }),
    "",
    "  #10;",
    "  $finish;",
    "end",
    "",
    "endmodule",
  ];

  return lines.join("\n");
}

export function getCodeGeneratorVerificationStatus(verification: VerificationResult): CodeGeneratorVerificationStatus {
  if (!verification.passed) return "fail";
  if (verification.checks.some((check) => check.skipped)) return "pending";
  return "pass";
}

export function buildCodeGeneratorArtifacts(input: BuildCodeGeneratorInput): CodeGeneratorArtifacts {
  const identifiers = makeIdentifierMap(input.variables, input.flipFlopType, input.equations);
  const isStateTableComplete = hasCompleteStateTable(input.stateTable, input.variables);
  const verificationStatus = getCodeGeneratorVerificationStatus(input.verification);

  if (!isStateTableComplete) {
    return {
      behavioralVerilog: "",
      gateLevelVerilog: "",
      isStateTableComplete,
      missingDataMessage: missingStateTableMessage,
      testbench: "",
      verificationStatus,
    };
  }

  return {
    behavioralVerilog: generateBehavioralVerilog(input.stateTable, input.variables, input.modelType, identifiers),
    gateLevelVerilog: generateGateLevelVerilog(input.equations, input.variables, input.flipFlopType, identifiers),
    isStateTableComplete,
    missingDataMessage: null,
    testbench: generateTestbench(input.variables, identifiers, input.timingTrace),
    verificationStatus,
  };
}
