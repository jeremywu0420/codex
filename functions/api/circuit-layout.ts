import {
  circuitGraphToSvg,
  collectWireJunctionDots,
  getCircuitContentBounds,
  layoutCircuitGraph,
} from "../../src/logic/circuitLayout";
import type { CircuitGraph } from "../../src/types";

const MAX_BODY_BYTES = 350_000;

const jsonHeaders = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
};

interface CircuitLayoutRequest {
  graph: CircuitGraph;
  showRoutingBounds?: boolean;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: jsonHeaders,
    status,
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePayload(value: unknown): CircuitLayoutRequest {
  if (!isObject(value)) throw new Error("Request body must be an object.");
  const input = isObject(value.input) ? value.input : value;
  if (!isObject(input)) throw new Error("Circuit layout input must be an object.");
  if (!isObject(input.graph)) throw new Error("graph must be an object.");

  const graph = input.graph;
  if (!Array.isArray(graph.nodes)) throw new Error("graph.nodes must be an array.");
  if (!Array.isArray(graph.edges)) throw new Error("graph.edges must be an array.");
  if (!isObject(graph.clockLine)) throw new Error("graph.clockLine must be an object.");
  if (!isObject(graph.metadata)) throw new Error("graph.metadata must be an object.");

  return {
    graph: graph as unknown as CircuitGraph,
    showRoutingBounds: input.showRoutingBounds === true,
  };
}

function buildCircuitLayout(input: CircuitLayoutRequest) {
  const graph = layoutCircuitGraph(input.graph);
  return {
    contentBounds: getCircuitContentBounds(graph),
    graph,
    junctionDots: collectWireJunctionDots(graph),
    svg: circuitGraphToSvg(graph, input.showRoutingBounds === true),
  };
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: jsonHeaders,
    status: 204,
  });
}

export async function onRequestGet() {
  return jsonResponse({
    ok: true,
    route: "/api/circuit-layout",
  });
}

export async function onRequestPost(context: { request: Request }) {
  try {
    const rawBody = await context.request.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return jsonResponse({ error: "Circuit layout payload is too large." }, 413);
    }

    return jsonResponse({
      result: buildCircuitLayout(validatePayload(JSON.parse(rawBody))),
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Circuit layout failed.",
      },
      400,
    );
  }
}
