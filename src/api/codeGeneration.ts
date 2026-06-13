import type { CodeGeneratorArtifacts } from "../logic/codeGenerator";
import type { TimingStep } from "../logic/timing";
import type { VerificationResult } from "../lib/verification";
import type { CircuitGraph, FlipFlopType, ModelType, StateTableRow, Variables } from "../types";

export interface CodeGenerationInput {
  completeVerification?: boolean;
  flipFlopType: FlipFlopType;
  generatedCircuitGraph?: CircuitGraph | null;
  initialStateBits: string;
  modelType: ModelType;
  stateTable: StateTableRow[];
  timingTrace?: TimingStep[] | null;
  variables: Variables;
}

export interface CodeGenerationResult {
  artifacts: CodeGeneratorArtifacts;
  generatedCircuitGraph: CircuitGraph | null;
  timingTrace: TimingStep[] | null;
  verification: VerificationResult;
}

interface CodeGenerationApiResponse {
  error?: string;
  result?: CodeGenerationResult;
}

async function runLocalDevCodeGeneration(input: CodeGenerationInput): Promise<CodeGenerationResult> {
  if (!import.meta.env.DEV) throw new Error("Code generation API is unavailable.");
  const [
    codeGenerator,
    circuitGraph,
    circuitLayout,
    equationsModule,
    timingModule,
    verificationModule,
  ] = await Promise.all([
    import("../logic/codeGenerator"),
    import("../logic/circuitGraph"),
    import("../logic/circuitLayout"),
    import("../logic/equations"),
    import("../logic/timing"),
    import("../lib/verification"),
  ]);

  const pipeline = equationsModule.deriveSequentialPipeline(input.stateTable, input.variables, input.modelType, input.flipFlopType);
  let generatedCircuitGraph = input.generatedCircuitGraph ?? null;
  let timingTrace = input.timingTrace ?? null;

  if (input.completeVerification) {
    const baseGraph = circuitGraph.buildCircuitGraph({
      equations: pipeline.circuitEquations,
      flipFlopType: input.flipFlopType,
      variables: input.variables,
    });
    const layoutedGraph = circuitLayout.layoutCircuitGraph(baseGraph);
    if (layoutedGraph.metadata.validationErrors?.length) {
      throw new Error(`Circuit validation failed:\n${layoutedGraph.metadata.validationErrors.join("\n")}`);
    }
    const initialState = Object.fromEntries(
      input.variables.states.map((stateName, index) => [stateName, (input.initialStateBits[index] === "1" ? "1" : "0") as "0" | "1"]),
    ) as Record<string, "0" | "1">;
    timingTrace = timingModule.generateTimingData(
      input.stateTable,
      input.modelType,
      input.flipFlopType,
      input.variables.states,
      input.variables.inputs,
      input.variables.outputs,
      timingModule.buildDefaultInputSequence(input.variables.inputs),
      initialState,
    ).steps;
    generatedCircuitGraph = layoutedGraph;
  }

  const verification = verificationModule.verifyAllResults({
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

  return {
    artifacts: codeGenerator.buildCodeGeneratorArtifacts({
      equations: pipeline.circuitEquations,
      initialStateBits: input.initialStateBits,
      flipFlopType: input.flipFlopType,
      modelType: input.modelType,
      stateTable: input.stateTable,
      timingTrace,
      variables: input.variables,
      verification,
    }),
    generatedCircuitGraph,
    timingTrace,
    verification,
  };
}

export async function generateCodeArtifactsApi(input: CodeGenerationInput, signal?: AbortSignal): Promise<CodeGenerationResult> {
  try {
    const response = await fetch("/api/code-generation", {
      body: JSON.stringify({ input }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
      signal,
    });
    const payload = (await response.json().catch(() => ({}))) as CodeGenerationApiResponse;
    if (!response.ok || !payload.result) {
      throw new Error(payload.error ?? "Code generation API failed.");
    }
    return payload.result;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (import.meta.env.DEV) return runLocalDevCodeGeneration(input);
    throw error instanceof Error ? error : new Error("Code generation API failed.");
  }
}
