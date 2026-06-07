import type { BooleanAst } from "./booleanParser";
import { parseBooleanEquation } from "./booleanParser";
import type { CircuitEdge, CircuitGraph, CircuitNode, Equation, FlipFlopType, Variables } from "../types";

export type CircuitGraphBuildInput = {
  equations: Equation[] | Record<string, string>;
  flipFlopType: FlipFlopType;
  variables: Variables;
};

const ffPinsByType: Record<FlipFlopType, string[]> = {
  jk: ["J", "K"],
  d: ["D"],
  t: ["T"],
  sr: ["S", "R"],
};

function normalizeEquations(equations: Equation[] | Record<string, string>): Equation[] {
  if (Array.isArray(equations)) return equations;
  return Object.entries(equations).map(([label, expression]) => ({
    id: label,
    label,
    expression,
    variableNames: [],
    minterms: [],
    dontCares: [],
  }));
}

function parseEquationLabel(label: string, stateVariables: string[], flipFlopType: FlipFlopType) {
  const compact = label.replace("_", "");
  const pins = ffPinsByType[flipFlopType];
  const pin = pins.find((candidate) => compact.startsWith(candidate));
  if (!pin) return { kind: "output" as const, outputName: label };
  const state = compact.slice(pin.length);
  if (!stateVariables.includes(state)) return { kind: "output" as const, outputName: label };
  return { kind: "ff-input" as const, pin, state };
}

function collectAstVariables(ast: BooleanAst, variables = new Set<string>()) {
  if (ast.type === "VAR") variables.add(ast.name);
  if (ast.type === "NOT") collectAstVariables(ast.value, variables);
  if (ast.type === "AND" || ast.type === "OR") ast.terms.forEach((term) => collectAstVariables(term, variables));
  return variables;
}

function canonicalExpressionKey(ast: BooleanAst): string {
  if (ast.type === "CONST") return ast.value;
  if (ast.type === "VAR") return ast.name;
  if (ast.type === "NOT") return `NOT(${canonicalExpressionKey(ast.value)})`;
  const terms = ast.terms.map(canonicalExpressionKey).sort();
  return `${ast.type}(${terms.join(",")})`;
}

function collectExpressionUsage(ast: BooleanAst, usage = new Map<string, number>()) {
  const key = canonicalExpressionKey(ast);
  usage.set(key, (usage.get(key) ?? 0) + 1);
  if (ast.type === "NOT") collectExpressionUsage(ast.value, usage);
  if (ast.type === "AND" || ast.type === "OR") ast.terms.forEach((term) => collectExpressionUsage(term, usage));
  return usage;
}

function makeNode(id: string, type: CircuitNode["type"], label: string, metadata?: CircuitNode["metadata"]): CircuitNode {
  return { id, type, label, x: 0, y: 0, metadata };
}

export function buildCircuitGraph({ equations, flipFlopType, variables }: CircuitGraphBuildInput): CircuitGraph {
  const normalizedEquations = normalizeEquations(equations);
  const nodes = new Map<string, CircuitNode>();
  const edges: CircuitEdge[] = [];
let gateCounter = 0;

  function addNode(node: CircuitNode) {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
    return node.id;
  }

  function addEdge(edge: CircuitEdge) {
    edges.push({ id: `${edge.from}->${edge.to}-${edges.length}`, ...edge });
  }

  function netIdForSignal(name: string) {
    return name.replace(/'/g, "_NOT").replace(/_/g, "").toUpperCase();
  }

function netIdForEquationLabel(label: string) {
    return label.replace(/_/g, "").toUpperCase();
  }

  function netIdForExpressionKey(key: string) {
    return `NET_${key}`.replace(/NOT\(([^()]+)\)/g, "NOT_$1").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  }

  const parsedEquationAsts = normalizedEquations.map((equation) => ({
    equation,
    ast: parseBooleanEquation(equation.expression),
  }));
  const expressionUsage = parsedEquationAsts.reduce((usage, item) => collectExpressionUsage(item.ast, usage), new Map<string, number>());
  const expressionRegistry = new Map<string, string>();

  for (const input of variables.inputs) addNode(makeNode(`input:${input}`, "INPUT", input));
  for (const output of variables.outputs) addNode(makeNode(`output:${output}`, "OUTPUT", output));
  for (const state of variables.states) {
    addNode({ ...makeNode(`state:${state}`, "STATE", state), pin: "Q" });
    addNode({ ...makeNode(`state-not:${state}`, "STATE_NOT", `${state}'`), pin: "Q'" });
    addNode({
      ...makeNode(`ff:${state}`, "FF", state, { state }),
      flipFlopType,
    });
  }

  function sourceForVariable(name: string) {
    if (variables.inputs.includes(name)) return `input:${name}`;
    if (variables.states.includes(name)) return `state:${name}`;
    return addNode(makeNode(`input:${name}`, "INPUT", name));
  }

  function sourceForComplement(name: string, target: CircuitNode["metadata"]) {
    if (variables.states.includes(name)) return `state-not:${name}`;
    const sourceId = sourceForVariable(name);
    const notId = addNode(makeNode(`not:${name}`, "NOT", `${name}'`, { ...target, source: name }));
    if (!edges.some((edge) => edge.from === sourceId && edge.to === notId)) addEdge({ from: sourceId, to: notId, netId: netIdForSignal(name) });
    return notId;
  }

  function buildFromAst(ast: BooleanAst, target: CircuitNode["metadata"], preferredNetId?: string): string {
    const expressionKey = canonicalExpressionKey(ast);
    const shouldShareExpression = (expressionUsage.get(expressionKey) ?? 0) > 1;
    if (shouldShareExpression && expressionRegistry.has(expressionKey)) return expressionRegistry.get(expressionKey)!;

    if (ast.type === "CONST") return addNode(makeNode(`const:${ast.value}`, "INPUT", ast.value));
    if (ast.type === "VAR") return sourceForVariable(ast.name);
    if (ast.type === "NOT" && ast.value.type === "VAR") return sourceForComplement(ast.value.name, target);
    if (ast.type === "NOT") {
      const gateIndex = gateCounter++;
      const childId = buildFromAst(ast.value, target);
      const nodeNetId = shouldShareExpression ? netIdForExpressionKey(expressionKey) : preferredNetId ?? `N${gateIndex}`;
      const nodeId = addNode(makeNode(`gate:not:${gateIndex}`, "NOT", "NOT", { ...target, outputNetId: nodeNetId }));
      addEdge({ from: childId, to: nodeId, netId: sourceNetId(childId) });
      if (shouldShareExpression) expressionRegistry.set(expressionKey, nodeId);
      return nodeId;
    }
    if (ast.type === "AND" || ast.type === "OR") {
      const nodeType = ast.type;
      const gateIndex = gateCounter++;
      const nodeNetId = shouldShareExpression ? netIdForExpressionKey(expressionKey) : preferredNetId ?? `N${gateIndex}`;
      const nodeId = addNode(makeNode(`gate:${nodeType.toLowerCase()}:${gateIndex}`, nodeType, nodeType, { ...target, outputNetId: nodeNetId }));
      ast.terms.forEach((term) => {
        const childId = buildFromAst(term, target);
        addEdge({ from: childId, to: nodeId, netId: sourceNetId(childId) });
      });
      if (shouldShareExpression) expressionRegistry.set(expressionKey, nodeId);
      return nodeId;
    }
    return sourceForVariable("0");
  }

  function sourceNetId(sourceId: string) {
    if (sourceId.startsWith("input:")) return netIdForSignal(sourceId.slice("input:".length));
    if (sourceId.startsWith("state-not:")) return netIdForSignal(`${sourceId.slice("state-not:".length)}'`);
    if (sourceId.startsWith("state:")) return netIdForSignal(sourceId.slice("state:".length));
    if (sourceId.startsWith("not:")) return netIdForSignal(`${sourceId.slice("not:".length)}'`);
    const sourceNode = nodes.get(sourceId);
    const netId = sourceNode?.metadata?.outputNetId;
    return typeof netId === "string" ? netId : sourceId.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
  }

  for (const { equation, ast } of parsedEquationAsts) {
    const parsedLabel = parseEquationLabel(equation.label, variables.states, flipFlopType);
    const astVariables = [...collectAstVariables(ast)];
    const expressionKey = canonicalExpressionKey(ast);
    const targetMetadata = {
      equationId: equation.id,
      equationLabel: equation.label,
      expression: equation.expression,
      canonicalExpressionKey: expressionKey,
      variables: astVariables.join(","),
      ...(parsedLabel.kind === "ff-input"
        ? { targetKind: "ff", targetState: parsedLabel.state, targetPin: parsedLabel.pin }
        : { targetKind: "output", targetOutput: parsedLabel.outputName }),
    };
    const equationNetId = netIdForEquationLabel(equation.label);
    const rootId = buildFromAst(ast, { ...targetMetadata, outputNetId: equationNetId }, equationNetId);
    const rootNetId = sourceNetId(rootId);

    if (parsedLabel.kind === "ff-input") {
      addEdge({
        from: rootId,
        to: `ff:${parsedLabel.state}`,
        toPin: parsedLabel.pin,
        label: equation.label,
        netId: rootNetId,
        metadata: { ...targetMetadata, outputNetId: rootNetId },
      });
    } else {
      const outputId = addNode(makeNode(`output:${parsedLabel.outputName}`, "OUTPUT", parsedLabel.outputName));
      addEdge({
        from: rootId,
        to: outputId,
        label: parsedLabel.outputName,
        netId: rootNetId,
        metadata: { ...targetMetadata, outputNetId: rootNetId },
      });
    }
  }

  for (const state of variables.states) {
    const usesQ = edges.some((edge) => edge.from === `state:${state}`);
    const usesQBar = edges.some((edge) => edge.from === `state-not:${state}`);
    if (usesQ) addEdge({ from: `ff:${state}`, to: `state:${state}`, fromPin: "Q", netId: netIdForSignal(state) });
    if (usesQBar) addEdge({ from: `ff:${state}`, to: `state-not:${state}`, fromPin: "Q'", netId: netIdForSignal(`${state}'`) });
  }

  return {
    nodes: [...nodes.values()],
    edges,
    clockLine: { label: variables.clock, points: [], branches: [] },
    metadata: {
      width: 0,
      height: 0,
      flipFlopType,
      stateVariables: variables.states,
      inputVariables: variables.inputs,
      outputVariables: variables.outputs,
    },
  };
}
