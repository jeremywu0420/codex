import { useEffect, useMemo, useState } from "react";
import { exportTimingPNG, exportTimingSVG } from "../export/timing";
import { buildDefaultInputSequence, generateTimingData, parseInputSequence, renderTimingDiagramSVG, timingStepsToConsoleRows } from "../logic/timing";
import { useCircuitStore } from "../store/useCircuitStore";
import type { TimingStep } from "../logic/timing";

function inputSequenceToText(sequence: Record<string, string>[], inputNames: string[]) {
  return sequence.map((frame) => inputNames.map((inputName) => frame[inputName]).join("")).join(", ");
}

function formatBits(names: string[], values: Record<string, string>) {
  return names.map((name) => values[name]).join("");
}

export function TimingDiagramPanel() {
  const { flipFlopType, modelType, stateTable, variables } = useCircuitStore();
  const [timingSvg, setTimingSvg] = useState("");
  const [generatedSignature, setGeneratedSignature] = useState("");
  const [error, setError] = useState("");
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [traceSteps, setTraceSteps] = useState<TimingStep[]>([]);
  const [inputSequenceText, setInputSequenceText] = useState(() =>
    inputSequenceToText(buildDefaultInputSequence(variables.inputs), variables.inputs),
  );

  useEffect(() => {
    setInputSequenceText(inputSequenceToText(buildDefaultInputSequence(variables.inputs), variables.inputs));
  }, [variables.inputs]);

  const currentSignature = useMemo(
    () =>
      JSON.stringify({
        flipFlopType,
        inputSequenceText,
        modelType,
        stateTable,
        variables: {
          inputs: variables.inputs,
          outputs: variables.outputs,
          states: variables.states,
        },
      }),
    [flipFlopType, inputSequenceText, modelType, stateTable, variables.inputs, variables.outputs, variables.states],
  );

  const canUseTiming = Boolean(timingSvg);
  const isOutdated = canUseTiming && generatedSignature !== currentSignature;

  function generateTimingDiagram() {
    setTimingSvg("");
    setTraceSteps([]);
    setGeneratedSignature("");
    setError("");
    try {
      const inputSequence = parseInputSequence(inputSequenceText, variables.inputs);
      const timingData = generateTimingData(
        stateTable,
        modelType,
        flipFlopType,
        variables.states,
        variables.inputs,
        variables.outputs,
        inputSequence,
      );
      console.table(timingStepsToConsoleRows(timingData.steps));
      setTimingSvg(renderTimingDiagramSVG(timingData));
      setTraceSteps(timingData.steps);
      setGeneratedSignature(currentSignature);
    } catch (generationError) {
      setTimingSvg("");
      setTraceSteps([]);
      setGeneratedSignature("");
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Timing diagram generation failed: invalid state table value.",
      );
    }
  }

  function resetTimingDiagram() {
    setTimingSvg("");
    setTraceSteps([]);
    setGeneratedSignature("");
    setError("");
  }

  async function downloadPng() {
    if (!timingSvg || isExportingPng) return;
    setError("");
    setIsExportingPng(true);
    try {
      await exportTimingPNG(timingSvg);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "PNG export failed.");
    } finally {
      setIsExportingPng(false);
    }
  }

  function downloadSvg() {
    if (!timingSvg) return;
    exportTimingSVG(timingSvg);
  }

  return (
    <section className="panel timing-panel">
      <div className="timing-config">
        <label className="field-label" htmlFor="timing-input-sequence">
          Input sequence ({variables.inputs.join("")})
        </label>
        <input
          className="text-field"
          id="timing-input-sequence"
          onChange={(event) => setInputSequenceText(event.target.value)}
          value={inputSequenceText}
        />
      </div>

      <div className="diagram-tools">
        <button onClick={generateTimingDiagram} type="button">Generate Timing Diagram</button>
        <button disabled={!canUseTiming} onClick={resetTimingDiagram} type="button">Reset Timing</button>
        <button disabled={!canUseTiming || isExportingPng} onClick={downloadPng} type="button">
          {isExportingPng ? "Exporting..." : "PNG"}
        </button>
        <button disabled={!canUseTiming} onClick={downloadSvg} type="button">SVG</button>
      </div>

      {error ? <div className="diagram-alert error">{error}</div> : null}
      {isOutdated ? <div className="diagram-alert warning">Timing diagram is outdated. Click Generate Timing Diagram again to update.</div> : null}

      <div className="timing-scroll" id="timing-diagram">
        {!timingSvg ? (
          <div className="diagram-placeholder">Click Generate Timing Diagram to create the waveform from the current state table.</div>
        ) : (
          <div dangerouslySetInnerHTML={{ __html: timingSvg }} />
        )}
      </div>

      {traceSteps.length ? (
        <div className="timing-trace">
          <h2>Debug / Trace Table</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Present State {variables.states.join("")}</th>
                  <th>{variables.inputs.join("")}</th>
                  <th>Next State {variables.states.map((state) => `${state}+`).join("")}</th>
                  <th>{variables.outputs.join("")}</th>
                </tr>
              </thead>
              <tbody>
                {traceSteps.map((step) => (
                  <tr key={step.step}>
                    <td>{step.step}</td>
                    <td>{formatBits(variables.states, step.currentState)}</td>
                    <td>{formatBits(variables.inputs, step.input)}</td>
                    <td>{formatBits(variables.states, step.nextState)}</td>
                    <td>{formatBits(variables.outputs, step.output)}</td>
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
