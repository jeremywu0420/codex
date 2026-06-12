import { PauseCircle, PlayCircle, RotateCcw, SkipForward, StepForward } from "lucide-react";

interface SimulationControlsProps {
  canRun: boolean;
  currentStep: number;
  isAutoRunning: boolean;
  maxStep: number;
  onReset: () => void;
  onRunAll: () => void;
  onStep: () => void;
  onToggleAutoRun: () => void;
  setSpeedMs: (value: number) => void;
  speedMs: number;
}

export function SimulationControls({
  canRun,
  currentStep,
  isAutoRunning,
  maxStep,
  onReset,
  onRunAll,
  onStep,
  onToggleAutoRun,
  setSpeedMs,
  speedMs,
}: SimulationControlsProps) {
  const isAtEnd = currentStep >= maxStep;

  return (
    <div className="simulation-controls">
      <button disabled={!canRun} onClick={onReset} type="button">
        <RotateCcw size={14} />
        Reset
      </button>
      <button disabled={!canRun || isAutoRunning || isAtEnd} onClick={onStep} type="button">
        <StepForward size={14} />
        Step
      </button>
      <button disabled={!canRun || (isAtEnd && !isAutoRunning)} onClick={onToggleAutoRun} type="button">
        {isAutoRunning ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
        {isAutoRunning ? "Pause" : "Auto Run"}
      </button>
      <button disabled={!canRun || isAutoRunning || isAtEnd} onClick={onRunAll} type="button">
        <SkipForward size={14} />
        Run All
      </button>
      <label className="simulation-speed">
        <span>Speed</span>
        <input
          disabled={!canRun || isAutoRunning}
          max="1400"
          min="160"
          onChange={(event) => setSpeedMs(Number(event.target.value))}
          step="40"
          type="range"
          value={speedMs}
        />
        <strong>{speedMs}ms</strong>
      </label>
    </div>
  );
}
