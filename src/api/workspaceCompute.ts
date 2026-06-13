import type { DesignLintResult } from "../lib/designLint";
import type { TimingStep } from "../logic/timing";
import type { VerificationResult } from "../lib/verification";
import type { CircuitGraph, Equation, FlipFlopType, KMapModel, ModelType, StateTableRow, Variables } from "../types";

export interface WorkspaceComputeInput {
  flipFlopType: FlipFlopType;
  generatedCircuitGraph?: CircuitGraph | null;
  initialStateBits: string;
  modelType: ModelType;
  stateTable: StateTableRow[];
  timingTrace?: TimingStep[] | null;
  variables: Variables;
}

export interface WorkspaceComputeResult {
  nextStateEquations: Equation[];
  excitationEquations: Equation[];
  outputEquations: Equation[];
  equations: Equation[];
  kMaps: KMapModel[];
  circuitGraph: CircuitGraph;
  generatedCircuitGraph: CircuitGraph | null;
  timingTrace: TimingStep[] | null;
  verification: VerificationResult;
  lint: DesignLintResult;
}

interface WorkspaceComputeApiResponse {
  error?: string;
  result?: WorkspaceComputeResult;
}

async function runLocalDevWorkspaceCompute(input: WorkspaceComputeInput): Promise<WorkspaceComputeResult> {
  if (!import.meta.env.DEV) throw new Error("Workspace compute API is unavailable.");
  const [circuitGraphModule, equationsModule, kmapModule, lintModule, verificationModule] = await Promise.all([
    import("../logic/circuitGraph"),
    import("../logic/equations"),
    import("../logic/kmap"),
    import("../lib/designLint"),
    import("../lib/verification"),
  ]);
  const pipeline = equationsModule.deriveSequentialPipeline(input.stateTable, input.variables, input.modelType, input.flipFlopType);
  const equations = pipeline.circuitEquations;
  const kMaps = equations.map(kmapModule.buildKMap);
  const circuitGraph = circuitGraphModule.buildCircuitGraph({
    equations,
    flipFlopType: input.flipFlopType,
    variables: input.variables,
  });
  const verification = verificationModule.verifyAllResults({
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
  const lint = lintModule.lintDesign({
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

export async function computeWorkspaceApi(input: WorkspaceComputeInput): Promise<WorkspaceComputeResult> {
  try {
    const response = await fetch("/api/workspace-compute", {
      body: JSON.stringify({ input }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = (await response.json().catch(() => ({}))) as WorkspaceComputeApiResponse;
    if (!response.ok || !payload.result) {
      throw new Error(payload.error ?? "Workspace compute API failed.");
    }
    return payload.result;
  } catch (error) {
    if (import.meta.env.DEV) return runLocalDevWorkspaceCompute(input);
    throw error instanceof Error ? error : new Error("Workspace compute API failed.");
  }
}
