import type { RunTestbenchSimulationInput, TestbenchSimulationResult } from "../logic/testbenchSimulation";

interface TestbenchSimulationApiResponse {
  error?: string;
  result?: TestbenchSimulationResult;
}

async function runLocalDevSimulation(input: RunTestbenchSimulationInput): Promise<TestbenchSimulationResult> {
  if (!import.meta.env.DEV) throw new Error("Simulation API is unavailable.");
  const module = await import("../logic/testbenchSimulation");
  return module.runTestbenchSimulation(input);
}

export async function runTestbenchSimulationApi(input: RunTestbenchSimulationInput): Promise<TestbenchSimulationResult> {
  try {
    const response = await fetch("/api/testbench-simulation", {
      body: JSON.stringify({ input }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = (await response.json().catch(() => ({}))) as TestbenchSimulationApiResponse;
    if (!response.ok || !payload.result) {
      throw new Error(payload.error ?? "Simulation API failed.");
    }
    return payload.result;
  } catch (error) {
    if (import.meta.env.DEV) return runLocalDevSimulation(input);
    throw error instanceof Error ? error : new Error("Simulation API failed.");
  }
}
