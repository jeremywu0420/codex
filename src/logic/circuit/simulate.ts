// Lightweight signal-value evaluation over a laid-out CircuitGraph. Given the current
// primary-input and present-state values, it propagates a logic value (0/1/X) to every
// net by walking the gate network, and computes the next state for a clock tick.
//
// This reads the existing graph structure only; it never mutates layout/routing.
import type { CircuitGraph, CircuitNode, FlipFlopType } from "../../types";

export type SignalValue = "0" | "1" | "X";

function invert(value: SignalValue): SignalValue {
  if (value === "0") return "1";
  if (value === "1") return "0";
  return "X";
}

function evalAnd(values: SignalValue[]): SignalValue {
  if (values.some((value) => value === "0")) return "0";
  if (values.some((value) => value === "X")) return "X";
  return "1";
}

function evalOr(values: SignalValue[]): SignalValue {
  if (values.some((value) => value === "1")) return "1";
  if (values.some((value) => value === "X")) return "X";
  return "0";
}

function outputNetOf(node: CircuitNode, graph: CircuitGraph) {
  const outgoing = graph.edges.find((edge) => edge.from === node.id && edge.netId);
  if (outgoing?.netId) return outgoing.netId;
  const metaNet = node.metadata?.outputNetId;
  return typeof metaNet === "string" ? metaNet : undefined;
}

/**
 * Propagate logic values to every net.
 * @param inputs  primary input name -> value (e.g. { X: "1" })
 * @param states  present state name -> value (e.g. { A: "0", B: "1" })
 */
export function evaluateNetValues(
  graph: CircuitGraph,
  inputs: Record<string, SignalValue>,
  states: Record<string, SignalValue>,
): Map<string, SignalValue> {
  const netValues = new Map<string, SignalValue>();

  // Seed nets that originate from primary inputs and state feedback taps.
  for (const node of graph.nodes) {
    if (node.type !== "INPUT" && node.type !== "STATE" && node.type !== "STATE_NOT") continue;
    const net = graph.edges.find((edge) => edge.from === node.id && edge.netId)?.netId;
    if (!net) continue;
    if (node.type === "INPUT") netValues.set(net, inputs[node.label] ?? "X");
    else if (node.type === "STATE") netValues.set(net, states[node.label] ?? "X");
    else netValues.set(net, invert(states[node.label.replace(/'/g, "")] ?? "X"));
  }

  // Relax the combinational gate network until stable (it is acyclic once the state
  // feedback taps above are treated as primary, so this converges in <= depth passes).
  const gateNodes = graph.nodes.filter((node) => node.type === "AND" || node.type === "OR" || node.type === "NOT");
  for (let pass = 0; pass <= gateNodes.length + 1; pass += 1) {
    let changed = false;
    for (const node of gateNodes) {
      const outputNet = outputNetOf(node, graph);
      if (!outputNet) continue;
      const inputNets = graph.edges.filter((edge) => edge.to === node.id).map((edge) => edge.netId);
      if (inputNets.some((net) => !net || !netValues.has(net))) continue;
      const inputVals = inputNets.map((net) => netValues.get(net!) ?? "X");
      const next = node.type === "NOT" ? invert(inputVals[0] ?? "X") : node.type === "AND" ? evalAnd(inputVals) : evalOr(inputVals);
      if (netValues.get(outputNet) !== next) {
        netValues.set(outputNet, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return netValues;
}

function nextBit(flipFlopType: FlipFlopType, q: SignalValue, pins: Record<string, SignalValue>): SignalValue {
  if (q === "X") return "X";
  if (flipFlopType === "d") return pins.D ?? "X";
  if (flipFlopType === "t") {
    const t = pins.T ?? "X";
    if (t === "X") return "X";
    return t === "1" ? invert(q) : q;
  }
  if (flipFlopType === "sr") {
    const s = pins.S ?? "X";
    const r = pins.R ?? "X";
    if (s === "X" || r === "X") return "X";
    if (s === "1" && r === "1") return "X"; // invalid
    if (s === "1") return "1";
    if (r === "1") return "0";
    return q;
  }
  // jk
  const j = pins.J ?? "X";
  const k = pins.K ?? "X";
  if (j === "X" || k === "X") return "X";
  if (j === "1" && k === "1") return invert(q);
  if (j === "1") return "1";
  if (k === "1") return "0";
  return q;
}

/** Compute the next present-state values after one clock edge. */
export function nextStateValues(
  graph: CircuitGraph,
  netValues: Map<string, SignalValue>,
  states: Record<string, SignalValue>,
): Record<string, SignalValue> {
  const flipFlopType = graph.metadata.flipFlopType;
  const next: Record<string, SignalValue> = { ...states };
  for (const node of graph.nodes) {
    if (node.type !== "FF") continue;
    const state = String(node.metadata?.state ?? node.label);
    const pins: Record<string, SignalValue> = {};
    for (const edge of graph.edges) {
      if (edge.to !== node.id) continue;
      const pin = edge.toPin ?? String(edge.metadata?.targetPin ?? "");
      if (!pin) continue;
      pins[pin] = (edge.netId && netValues.get(edge.netId)) || "X";
    }
    next[state] = nextBit(flipFlopType, states[state] ?? "X", pins);
  }
  return next;
}
