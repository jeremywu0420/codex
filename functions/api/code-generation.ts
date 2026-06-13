import { buildCodeGeneratorArtifacts } from "../../src/logic/codeGenerator";
import { buildCircuitGraph } from "../../src/logic/circuitGraph";
import { layoutCircuitGraph } from "../../src/logic/circuitLayout";
import { deriveSequentialPipeline } from "../../src/logic/equations";
import { buildDefaultInputSequence, generateTimingData } from "../../src/logic/timing";
import type { TimingStep } from "../../src/logic/timing";
import { verifyAllResults } from "../../src/lib/verification";
import type { CircuitGraph, FlipFlopType, ModelType, StateTableRow, Variables } from "../../src/types";

const MAX_BODY_BYTES = 300_000;

const jsonHeaders = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
};

interface CodeGenerationRequest {
  completeVerification?: boolean;
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

function validatePayload(value: unknown): CodeGenerationRequest {
  assertObject(value, "Request body");
  const input = isObject(value.input) ? value.input : value;
  assertObject(input, "Code generation input");

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

  return input as unknown as CodeGenerationRequest;
}

function initialStateFromBits(variables: Variables, bits: string) {
  return Object.fromEntries(
    variables.states.map((stateName, index) => [stateName, (bits[index] === "1" ? "1" : "0") as "0" | "1"]),
  ) as Record<string, "0" | "1">;
}

function buildCodeGeneration(input: CodeGenerationRequest) {
  const pipeline = deriveSequentialPipeline(input.stateTable, input.variables, input.modelType, input.flipFlopType);
  const equations = pipeline.circuitEquations;
  let generatedCircuitGraph = input.generatedCircuitGraph ?? null;
  let timingTrace = input.timingTrace ?? null;

  if (input.completeVerification) {
    const baseGraph = buildCircuitGraph({ equations, flipFlopType: input.flipFlopType, variables: input.variables });
    const layoutedGraph = layoutCircuitGraph(baseGraph);
    if (layoutedGraph.metadata.validationErrors?.length) {
      throw new Error(`Circuit validation failed:\n${layoutedGraph.metadata.validationErrors.join("\n")}`);
    }

    const timingData = generateTimingData(
      input.stateTable,
      input.modelType,
      input.flipFlopType,
      input.variables.states,
      input.variables.inputs,
      input.variables.outputs,
      buildDefaultInputSequence(input.variables.inputs),
      initialStateFromBits(input.variables, input.initialStateBits),
    );
    generatedCircuitGraph = layoutedGraph;
    timingTrace = timingData.steps;
  }

  const verification = verifyAllResults({
    stateTable: input.stateTable,
    modelType: input.modelType,
    flipFlopType: input.flipFlopType,
    variables: input.variables,
    nextStateEquations: pipeline.nextStateEquations,
    excitationEquations: pipeline.excitationEquations,
    outputEquations: pipeline.outputEquations,
    timingTrace,
    circuitGraph: generatedCircuitGraph,
  });

  const artifacts = buildCodeGeneratorArtifacts({
    equations,
    flipFlopType: input.flipFlopType,
    modelType: input.modelType,
    stateTable: input.stateTable,
    timingTrace,
    variables: input.variables,
    verification,
  });

  return {
    artifacts,
    generatedCircuitGraph,
    timingTrace,
    verification,
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
    route: "/api/code-generation",
  });
}

export async function onRequestPost(context: { request: Request }) {
  try {
    const rawBody = await context.request.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return jsonResponse({ error: "Code generation payload is too large." }, 413);
    }

    return jsonResponse({
      result: buildCodeGeneration(validatePayload(JSON.parse(rawBody))),
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Code generation failed.",
      },
      400,
    );
  }
}
