import { runTestbenchSimulation } from "../../src/logic/testbenchSimulation";
import type { RunTestbenchSimulationInput } from "../../src/logic/testbenchSimulation";

const MAX_BODY_BYTES = 200_000;

const jsonHeaders = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: jsonHeaders,
    status,
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
}

function assertStringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
}

function validatePayload(value: unknown): RunTestbenchSimulationInput {
  assertObject(value, "Request body");
  const input = isObject(value.input) ? value.input : value;
  assertObject(input, "Simulation input");

  if (input.modelType !== "mealy" && input.modelType !== "moore") throw new Error("modelType must be mealy or moore.");
  if (!["jk", "t", "sr", "d"].includes(String(input.flipFlopType))) throw new Error("Unsupported flipFlopType.");
  if (typeof input.initialStateBits !== "string") throw new Error("initialStateBits must be a string.");
  if (!Array.isArray(input.stateTable)) throw new Error("stateTable must be an array.");
  if (input.timingTrace !== null && input.timingTrace !== undefined && !Array.isArray(input.timingTrace)) {
    throw new Error("timingTrace must be an array or null.");
  }

  assertObject(input.variables, "variables");
  assertStringArray(input.variables.inputs, "variables.inputs");
  assertStringArray(input.variables.states, "variables.states");
  assertStringArray(input.variables.outputs, "variables.outputs");
  if (typeof input.variables.clock !== "string") throw new Error("variables.clock must be a string.");

  return input as unknown as RunTestbenchSimulationInput;
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
    route: "/api/testbench-simulation",
  });
}

export async function onRequestPost(context: { request: Request }) {
  try {
    const rawBody = await context.request.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return jsonResponse({ error: "Simulation payload is too large." }, 413);
    }

    const input = validatePayload(JSON.parse(rawBody));
    return jsonResponse({
      result: runTestbenchSimulation(input),
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Simulation failed.",
      },
      400,
    );
  }
}
