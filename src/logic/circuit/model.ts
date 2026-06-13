// Rich, render-friendly view-model derived from a laid-out CircuitGraph.
//
// This is a *compatibility layer*: the routing/layout/validation pipeline keeps using
// the existing CircuitGraph/CircuitEdge/CircuitNode types untouched. toCircuitModel()
// projects that graph into first-class wires (with signalName / color / isBus and
// structured {nodeId, pin} endpoints) and components for the UI to consume.
import type { CircuitGraph, CircuitNode } from "../../types";
import type { Point } from "./geometry";
import { pointsFromFlat } from "./geometry";
import { nodeLabelNet } from "./nets";

export type CircuitSignalClass = "clock" | "state" | "input" | "logic";

export interface CircuitPinRef {
  nodeId: string;
  pin: string;
}

export interface CircuitWireModel {
  id: string;
  netId: string;
  signalName: string;
  from: CircuitPinRef;
  to: CircuitPinRef;
  points: Point[];
  signalClass: CircuitSignalClass;
  color: string;
  isBus: boolean;
}

export interface CircuitComponentModel {
  id: string;
  type: CircuitNode["type"];
  label: string;
}

export interface CircuitModel {
  components: CircuitComponentModel[];
  wires: CircuitWireModel[];
}

/** Soft, distinct colours per signal class so the same signal reads consistently. */
export const signalPalette: Record<CircuitSignalClass, string> = {
  clock: "#2563eb",
  state: "#7c3aed",
  input: "#0891b2",
  logic: "#475569",
};

function incomingPin(edgeToPin: string | undefined, gateInputIndex: number | undefined) {
  if (edgeToPin) return edgeToPin;
  if (typeof gateInputIndex === "number") return `in${gateInputIndex}`;
  return "in";
}

export function classifySignal(netId: string, stateNets: Set<string>, inputNets: Set<string>): CircuitSignalClass {
  if (netId === "CLK") return "clock";
  if (stateNets.has(netId)) return "state";
  if (inputNets.has(netId)) return "input";
  return "logic";
}

export function toCircuitModel(graph: CircuitGraph): CircuitModel {
  const stateNets = new Set(graph.metadata.stateVariables.flatMap((state) => [nodeLabelNet(state), nodeLabelNet(`${state}'`)]));
  const inputNets = new Set(graph.metadata.inputVariables.flatMap((input) => [nodeLabelNet(input), nodeLabelNet(`${input}'`)]));

  const fanout = new Map<string, number>();
  for (const edge of graph.edges) {
    if (!edge.netId) continue;
    fanout.set(edge.netId, (fanout.get(edge.netId) ?? 0) + 1);
  }

  const wires: CircuitWireModel[] = graph.edges.map((edge) => {
    const netId = edge.netId ?? "";
    const signalClass = classifySignal(netId, stateNets, inputNets);
    const gateInputIndex = typeof edge.metadata?.gateInputIndex === "number" ? edge.metadata.gateInputIndex : undefined;
    return {
      id: edge.wireId ?? edge.id ?? `${edge.from}->${edge.to}`,
      netId,
      signalName: netId,
      from: { nodeId: edge.from, pin: edge.fromPin ?? "out" },
      to: { nodeId: edge.to, pin: incomingPin(edge.toPin, gateInputIndex) },
      points: pointsFromFlat(edge.points),
      signalClass,
      color: signalPalette[signalClass],
      // No multi-bit nets exist yet; treat a high-fanout trunk as a "bus" so it can be
      // drawn slightly heavier. The field is here for real buses added later.
      isBus: (fanout.get(netId) ?? 0) >= 3,
    };
  });

  const components: CircuitComponentModel[] = graph.nodes.map((node) => ({ id: node.id, type: node.type, label: node.label }));
  return { components, wires };
}
