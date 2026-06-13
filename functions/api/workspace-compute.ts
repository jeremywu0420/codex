import { buildCircuitGraph } from "../../src/logic/circuitGraph";
import { deriveSequentialPipeline } from "../../src/logic/equations";
import { buildKMap } from "../../src/logic/kmap";
import type { TimingStep } from "../../src/logic/timing";
import { lintDesign } from "../../src/lib/designLint";
import { verifyAllResults } from "../../src/lib/verification";
import type { CircuitGraph, FlipFlopType, ModelType, StateTableRow, Variables } from "../../src/types";

const MAX_BODY_BYTES = 350_000;

const jsonHeaders = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
};

interface WorkspaceComputeRequest {
  flipFlopType: FlipFlopType;
  generatedCircuitGraph?: CircuitGraph | null;
  initialStateBits: string;
  modelType: ModelType;
  stateTable: StateTableRow[];
  timingTrace?: TimingStep[] | null;
  variables: Variables;
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

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
}

function assertStringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
}

function validatePayload(value: unknown): WorkspaceComputeRequest {
  assertObject(value, "Request body");
  const input = isObject(value.input) ? value.input : value;
  assertObject(input, "Workspace compute input");

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

  return input as unknown as WorkspaceComputeRequest;
}

function computeWorkspace(input: WorkspaceComputeRequest) {
  const pipeline = deriveSequentialPipeline(input.stateTable, input.variables, input.modelType, input.flipFlopType);
  const equations = pipeline.circuitEquations;
  const kMaps = equations.map(buildKMap);
  const circuitGraph = buildCircuitGraph({ equations, flipFlopType: input.flipFlopType, variables: input.variables });
  const verification = verifyAllResults({
    stateTable: input.stateTable,
    modelType: input.modelType,
    flipFlopType: input.flipFlopType,
    variables: input.variables,
    nextStateEquations: pipeline.nextStateEquations,
    excitationEquations: pipeline.excitationEquations,
    outputEquations: pipeline.outputEquations,
    timingTrace: input.timingTrace ?? null,
    circuitGraph: input.generatedCircuitGraph ?? null,
  });
  const lint = lintDesign({
    stateTable: input.stateTable,
    variables: input.variables,
    modelType: input.modelType,
    initialStateBits: input.initialStateBits,
  });

  return {
    nextStateEquations: pipeline.nextStateEquations,
    excitationEquations: pipeline.excitationEquations,
    outputEquations: pipeline.outputEquations,
    equations,
    kMaps,
    circuitGraph,
    generatedCircuitGraph: input.generatedCircuitGraph ?? null,
    timingTrace: input.timingTrace ?? null,
    verification,
    lint,
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
    route: "/api/workspace-compute",
  });
}

export async function onRequestPost(context: { request: Request }) {
  try {
    const rawBody = await context.request.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return jsonResponse({ error: "Workspace compute payload is too large." }, 413);
    }

    return jsonResponse({
      result: computeWorkspace(validatePayload(JSON.parse(rawBody))),
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Workspace compute failed.",
      },
      400,
    );
  }
}
