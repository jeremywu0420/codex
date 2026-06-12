import { useEffect, useRef, useState } from "react";
import { exportTimingPNG, exportTimingSVG } from "../export/timing";
import { buildDefaultInputSequence } from "../logic/timing";
import { useCircuitStore } from "../store/useCircuitStore";
import { SimulationControls } from "./timing/SimulationControls";
import { TimingDiagram } from "./timing/TimingDiagram";
import { useSimulation } from "./timing/useSimulation";
import type { SimulationCycle } from "./timing/useSimulation";

function inputSequenceToText(sequence: Record<string, string>[], inputNames: string[]) {
  return sequence.map((frame) => inputNames.map((inputName) => frame[inputName]).join("")).join(" ");
}

function statusLabel(cycle: SimulationCycle | null) {
  return cycle?.result.toUpperCase() ?? "PENDING";
}

export function TimingDiagramPanel() {
  const { flipFlopType, initialStateBits, modelType, setTimingTrace, stateTable, variables } = useCircuitStore();
  const diagramRef = useRef<HTMLDivElement>(null);
  const [inputSequenceText, setInputSequenceText] = useState(() =>
    inputSequenceToText(buildDefaultInputSequence(variables.inputs), variables.inputs),
  );
  const [isExportingPng, setIsExportingPng] = useState(false);
  const {
    currentStep,
    error,
    isAutoRunning,
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
  } = useSimulation({
    flipFlopType,
    initialStateBits,
    inputSequenceText,
    modelType,
    stateTable,
    variables,
  });
  const canUseTiming = Boolean(simulation && !error);
  const visibleConsoleLines = simulation?.consoleLines.slice(0, currentStep + 1) ?? [];

  useEffect(() => {
    setInputSequenceText(inputSequenceToText(buildDefaultInputSequence(variables.inputs), variables.inputs));
  }, [variables.inputs]);

  useEffect(() => {
    setTimingTrace(canUseTiming ? simulation?.timingData.steps ?? null : null);
  }, [canUseTiming, setTimingTrace, simulation?.timingData.steps]);

  function serializeDiagram() {
    const svg = diagramRef.current?.querySelector("svg");
    return svg ? new XMLSerializer().serializeToString(svg) : null;
  }

  async function downloadPng() {
    const markup = serializeDiagram();
    if (!markup || isExportingPng) return;
    setIsExportingPng(true);
    try {
      await exportTimingPNG(markup);
    } finally {
      setIsExportingPng(false);
    }
  }

  function downloadSvg() {
    const markup = serializeDiagram();
    if (markup) exportTimingSVG(markup);
  }

  return (
    <section className="panel timing-panel">
      <div className="timing-toolbar-card">
        <div className="timing-config timing-config-enhanced">
          <div className="timing-input-control">
            <label className="field-label" htmlFor="timing-input-sequence">
              Input sequence ({variables.inputs.join("") || "X"})
            </label>
            <input
              className="text-field"
              id="timing-input-sequence"
              onChange={(event) => setInputSequenceText(event.target.value)}
              value={inputSequenceText}
            />
          </div>
          <span className={`timing-sim-status ${simulation?.passed ? "pass" : "fail"}`}>
            {simulation?.passed ? "PASS" : "FAIL"}
          </span>
        </div>

        <SimulationControls
          canRun={canUseTiming}
          currentStep={currentStep}
          isAutoRunning={isAutoRunning}
          maxStep={maxStep}
          onReset={reset}
          onRunAll={runAll}
          onStep={step}
          onToggleAutoRun={toggleAutoRun}
          setSpeedMs={setSpeedMs}
          speedMs={speedMs}
        />

        <div className="diagram-tools timing-export-tools">
          <button disabled={!canUseTiming || isExportingPng} onClick={downloadPng} type="button">
            {isExportingPng ? "Exporting..." : "PNG"}
          </button>
          <button disabled={!canUseTiming} onClick={downloadSvg} type="button">
            SVG
          </button>
        </div>
      </div>

      {error ? <div className="diagram-alert error">{error}</div> : null}

      <div className="timing-scroll interactive-timing-scroll" id="timing-diagram" ref={diagramRef}>
        {!canUseTiming || !simulation ? (
          <div className="diagram-placeholder">Timing simulation is unavailable for the current input sequence.</div>
        ) : (
          <TimingDiagram currentStep={currentStep} cycles={simulation.cycles} onSelectStep={jumpToStep} variables={variables} />
        )}
      </div>

      {canUseTiming && simulation ? (
        <div className="timing-simulator-grid">
          <section className="timing-state-card">
            <div className="timing-card-header">
              <h2>State Diagram</h2>
              <span className={`timing-step-status ${selectedCycle?.result ?? "fail"}`}>{statusLabel(selectedCycle)}</span>
            </div>
            <div className="timing-state-flow">
              <span>{selectedCycle?.actualPresentState ?? "--"}</span>
              <strong>{selectedCycle?.inputBits ?? "-"}</strong>
              <span>{selectedCycle?.actualNextState ?? "--"}</span>
            </div>
            <dl className="timing-current-values">
              <div>
                <dt>Step</dt>
                <dd>{selectedCycle?.step ?? 0}</dd>
              </div>
              <div>
                <dt>X</dt>
                <dd>{selectedCycle?.inputBits ?? "-"}</dd>
              </div>
              <div>
                <dt>Z</dt>
                <dd>{selectedCycle?.actualOutput ?? "-"}</dd>
              </div>
              <div>
                <dt>Next</dt>
                <dd>{selectedCycle?.actualNextState ?? "--"}</dd>
              </div>
            </dl>
          </section>

          <section className="timing-console-card">
            <div className="timing-card-header">
              <h2>Console</h2>
              <span>{visibleConsoleLines.length}/{simulation.consoleLines.length}</span>
            </div>
            <pre className="timing-console">
              {visibleConsoleLines.map((line, index) => (
                <span
                  className={`timing-console-line ${line.startsWith("PASS") ? "pass" : "fail"} ${index === currentStep ? "active" : ""}`}
                  key={`${line}-${index}`}
                >
                  {line}
                  {"\n"}
                </span>
              ))}
            </pre>
          </section>
        </div>
      ) : null}

      {canUseTiming && simulation ? (
        <div className="timing-trace interactive-timing-table">
          <h2>Simulation Table</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Step</th>
                  <th>{variables.inputs.join("") || "X"}</th>
                  <th>Present State</th>
                  <th>Expected {variables.outputs.join("") || "Z"}</th>
                  <th>Actual {variables.outputs.join("") || "Z"}</th>
                  <th>Expected Next State</th>
                  <th>Actual Next State</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {simulation.cycles.map((cycle, index) => (
                  <tr className={index === currentStep ? "active-cycle-row" : ""} key={cycle.step} onClick={() => jumpToStep(index)}>
                    <td>{cycle.step}</td>
                    <td>{cycle.inputBits}</td>
                    <td>{cycle.actualPresentState}</td>
                    <td>{cycle.expectedOutput}</td>
                    <td>{cycle.actualOutput}</td>
                    <td>{cycle.expectedNextState}</td>
                    <td>{cycle.actualNextState}</td>
                    <td className={`timing-result-cell ${cycle.result}`}>{cycle.result.toUpperCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
