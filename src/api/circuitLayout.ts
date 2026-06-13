import type { CircuitBounds, CircuitGraph, CircuitPoint } from "../types";

export interface CircuitLayoutResult {
  contentBounds: CircuitBounds;
  graph: CircuitGraph;
  junctionDots: CircuitPoint[];
  svg: string;
}

interface CircuitLayoutApiResponse {
  error?: string;
  result?: CircuitLayoutResult;
}

async function runLocalDevCircuitLayout(graph: CircuitGraph, showRoutingBounds: boolean): Promise<CircuitLayoutResult> {
  if (!import.meta.env.DEV) throw new Error("Circuit layout API is unavailable.");
  const circuitLayout = await import("../logic/circuitLayout");
  const layoutedGraph = circuitLayout.layoutCircuitGraph(graph);
  return {
    contentBounds: circuitLayout.getCircuitContentBounds(layoutedGraph),
    graph: layoutedGraph,
    junctionDots: circuitLayout.collectWireJunctionDots(layoutedGraph),
    svg: circuitLayout.circuitGraphToSvg(layoutedGraph, showRoutingBounds),
  };
}

export async function layoutCircuitGraphApi(graph: CircuitGraph, showRoutingBounds = false): Promise<CircuitLayoutResult> {
  try {
    const response = await fetch("/api/circuit-layout", {
      body: JSON.stringify({ input: { graph, showRoutingBounds } }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = (await response.json().catch(() => ({}))) as CircuitLayoutApiResponse;
    if (!response.ok || !payload.result) {
      throw new Error(payload.error ?? "Circuit layout API failed.");
    }
    return payload.result;
  } catch (error) {
    if (import.meta.env.DEV) return runLocalDevCircuitLayout(graph, showRoutingBounds);
    throw error instanceof Error ? error : new Error("Circuit layout API failed.");
  }
}
