import { useCallback, useEffect, useMemo, useState } from "react";
import { buildTimingSimulationApi } from "../../api/timingSimulation";
import type { BuildInteractiveSimulationInput, InteractiveSimulation } from "../../logic/interactiveSimulation";

export type {
  BuildInteractiveSimulationInput,
  CycleResult,
  InteractiveSimulation,
  SimulationCycle,
} from "../../logic/interactiveSimulation";

export interface UseSimulationInput extends BuildInteractiveSimulationInput {
  autoRunSpeedMs?: number;
}

export function useSimulation(input: UseSimulationInput) {
  const [currentStep, setCurrentStep] = useState(0);
  const [error, setError] = useState("");
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [simulation, setSimulation] = useState<InteractiveSimulation | null>(null);
  const [speedMs, setSpeedMs] = useState(input.autoRunSpeedMs ?? 650);
  const signature = useMemo(
    () =>
      JSON.stringify({
        flipFlopType: input.flipFlopType,
        initialStateBits: input.initialStateBits,
        inputSequenceText: input.inputSequenceText,
        modelType: input.modelType,
        stateTable: input.stateTable,
        variables: input.variables,
      }),
    [input],
  );

  useEffect(() => {
    const controller = new AbortController();
    setCurrentStep(0);
    setError("");
    setIsAutoRunning(false);
    setIsLoading(true);
    buildTimingSimulationApi(input, controller.signal)
      .then((result) => {
        setSimulation(result);
      })
      .catch((requestError) => {
        if (controller.signal.aborted) return;
        setSimulation(null);
        setError(requestError instanceof Error ? requestError.message : "Timing simulation failed.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [signature]);

  const maxStep = Math.max(0, (simulation?.cycles.length ?? 1) - 1);
  const selectedCycle = simulation?.cycles[currentStep] ?? null;

  useEffect(() => {
    if (!isAutoRunning || !simulation?.cycles.length) return undefined;
    const timer = window.setInterval(() => {
      setCurrentStep((step) => {
        if (step >= maxStep) {
          setIsAutoRunning(false);
          return step;
        }
        return step + 1;
      });
    }, speedMs);

    return () => window.clearInterval(timer);
  }, [isAutoRunning, maxStep, simulation?.cycles.length, speedMs]);

  const reset = useCallback(() => {
    setIsAutoRunning(false);
    setCurrentStep(0);
  }, []);

  const step = useCallback(() => {
    setCurrentStep((value) => Math.min(value + 1, maxStep));
  }, [maxStep]);

  const runAll = useCallback(() => {
    setIsAutoRunning(false);
    setCurrentStep(maxStep);
  }, [maxStep]);

  const toggleAutoRun = useCallback(() => {
    setIsAutoRunning((value) => !value);
  }, []);

  const jumpToStep = useCallback(
    (stepIndex: number) => {
      setCurrentStep(Math.min(Math.max(stepIndex, 0), maxStep));
    },
    [maxStep],
  );

  return {
    currentStep,
    error,
    isAutoRunning,
    isLoading,
    jumpToStep,
    maxStep,
    reset,
    runAll,
    selectedCycle,
    setSpeedMs,
    simulation,
    speedMs,
    step,
    toggleAutoRun,
  };
}
