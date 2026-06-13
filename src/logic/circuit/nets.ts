// Net / wire identity helpers (stable string ids used by routing and validation).
import type { CircuitEdge } from "../../types";

export function sanitizeWireId(value: string) {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function makeWireId(edge: CircuitEdge) {
  const fromPin = edge.fromPin ?? "out";
  const toPin = edge.toPin ?? (typeof edge.metadata?.gateInputIndex === "number" ? `in${edge.metadata.gateInputIndex}` : "in");
  return sanitizeWireId(`${edge.netId ?? "NET"}_${edge.from}_${fromPin}_to_${edge.to}_${toPin}`);
}

/** Canonical net id derived from a node label, e.g. "A'" -> "A_NOT". */
export function nodeLabelNet(label: string) {
  return label.replace(/'/g, "_NOT").replace(/_/g, "").toUpperCase();
}
