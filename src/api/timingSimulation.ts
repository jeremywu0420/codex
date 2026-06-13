import type { BuildInteractiveSimulationInput, InteractiveSimulation } from "../logic/interactiveSimulation";

interface TimingSimulationApiResponse {
  error?: string;
  result?: InteractiveSimulation;
}

async function runLocalDevTimingSimulation(input: BuildInteractiveSimulationInput): Promise<InteractiveSimulation> {
  if (!import.meta.env.DEV) throw new Error("Timing simulation API is unavailable.");
  const module = await import("../logic/interactiveSimulation");
  return module.buildInteractiveSimulation(input);
}

export async function buildTimingSimulationApi(input: BuildInteractiveSimulationInput, signal?: AbortSignal): Promise<InteractiveSimulation> {
  try {
    const response = await fetch("/api/timing-simulation", {
      body: JSON.stringify({ input }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
      signal,
    });
    const payload = (await response.json().catch(() => ({}))) as TimingSimulationApiResponse;
    if (!response.ok || !payload.result) {
      throw new Error(payload.error ?? "Timing simulation API failed.");
    }
    return payload.result;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (import.meta.env.DEV) return runLocalDevTimingSimulation(input);
    throw error instanceof Error ? error : new Error("Timing simulation API failed.");
  }
}
