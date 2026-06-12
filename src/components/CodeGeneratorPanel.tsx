import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Clipboard, Download, PlayCircle } from "lucide-react";
import { buildCodeGeneratorArtifacts, type CodeTabId } from "../logic/codeGenerator";
import { layoutCircuitGraph } from "../logic/circuitLayout";
import { buildDefaultInputSequence, generateTimingData } from "../logic/timing";
import { runTestbenchSimulation } from "../logic/testbenchSimulation";
import type { TestbenchSimulationResult } from "../logic/testbenchSimulation";
import { useCircuitStore } from "../store/useCircuitStore";

const VERILOG_KEYWORDS = new Set([
  "always", "assign", "begin", "case", "casex", "casez", "default", "else", "end", "endcase",
  "endfunction", "endmodule", "endtask", "for", "forever", "function", "if", "initial", "inout",
  "input", "integer", "localparam", "module", "negedge", "or", "output", "parameter", "posedge",
  "reg", "repeat", "task", "wait", "while", "wire",
]);

// Lightweight client-side Verilog tokenizer: comments, sized literals, system tasks, keywords.
const VERILOG_TOKEN_REGEX = /(\/\/[^\n]*)|(\d+'[bdhoBDHO][0-9a-fA-FxzXZ_?]+|\b\d+\b)|(\$[A-Za-z_]\w*)|(`[A-Za-z_]\w*)|([A-Za-z_]\w*)/g;

function highlightVerilog(code: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of code.matchAll(VERILOG_TOKEN_REGEX)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(code.slice(lastIndex, index));
    const [text, comment, number, system, directive, word] = match;
    if (comment) nodes.push(<span className="tok-comment" key={key++}>{text}</span>);
    else if (number) nodes.push(<span className="tok-number" key={key++}>{text}</span>);
    else if (system || directive) nodes.push(<span className="tok-system" key={key++}>{text}</span>);
    else if (word && VERILOG_KEYWORDS.has(word)) nodes.push(<span className="tok-keyword" key={key++}>{text}</span>);
    else nodes.push(text);
    lastIndex = index + text.length;
  }
  if (lastIndex < code.length) nodes.push(code.slice(lastIndex));
  return nodes;
}

function VerilogCode({ code, className = "" }: { code: string; className?: string }) {
  const highlighted = useMemo(() => highlightVerilog(code), [code]);
  return (
    <pre className={`code-block ${className}`.trim()}>
      <code>{highlighted}</code>
    </pre>
  );
}

const tabs: { id: CodeTabId; label: string }[] = [
  { id: "behavioral", label: "Behavioral Verilog" },
  { id: "gate", label: "Gate-Level Verilog" },
  { id: "testbench", label: "Testbench" },
];

function downloadText(fileName: string, code: string) {
  const link = document.createElement("a");
  link.download = fileName;
  link.href = URL.createObjectURL(new Blob([code], { type: "text/plain;charset=utf-8" }));
  link.click();
  URL.revokeObjectURL(link.href);
}

function fallbackCopy(text: string) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}

function verificationLabel(status: ReturnType<typeof buildCodeGeneratorArtifacts>["verificationStatus"]) {
  if (status === "fail") return "FAIL";
  if (status === "pending") return "PENDING";
  return "PASS";
}

function SimulationResultPanel({
  error,
  inputLabel,
  onRun,
  outputLabel,
  result,
}: {
  error: string;
  inputLabel: string;
  onRun: () => void;
  outputLabel: string;
  result: TestbenchSimulationResult | null;
}) {
  const status = result?.status ?? "idle";
  const statusText = status === "idle" ? "NOT RUN" : status.toUpperCase();

  return (
    <aside className="simulation-panel">
      <div className="simulation-header">
        <h3>Simulation Result</h3>
        <span className={`simulation-status ${status}`}>{statusText}</span>
      </div>
      <div className="simulation-actions">
        <button onClick={onRun} type="button">
          <PlayCircle size={14} />
          Run Simulation
        </button>
      </div>
      {error ? <div className="diagram-alert error simulation-error">{error}</div> : null}
      <pre className="simulation-console">
        {result ? (
          result.consoleLines.map((line, index) => (
            <span className={`simulation-console-line ${line.startsWith("PASS") ? "pass" : "fail"}`} key={`${line}-${index}`}>
              {line}
              {"\n"}
            </span>
          ))
        ) : (
          <span className="simulation-console-line muted">No simulation run yet.</span>
        )}
      </pre>
      {result ? (
        <div className="simulation-table-wrap">
          <table className="simulation-table">
            <thead>
              <tr>
                <th>Step</th>
                <th>{inputLabel}</th>
                <th>Present State</th>
                <th>Expected {outputLabel}</th>
                <th>Actual {outputLabel}</th>
                <th>Expected Next State</th>
                <th>Actual Next State</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.step}>
                  <td>{row.step}</td>
                  <td>{row.inputBits}</td>
                  <td>{row.expectedPresentState}</td>
                  <td>{row.expectedOutput}</td>
                  <td>{row.actualOutput}</td>
                  <td>{row.expectedNextState}</td>
                  <td>{row.actualNextState}</td>
                  <td className={`simulation-result-cell ${row.result}`}>{row.result.toUpperCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </aside>
  );
}

export function CodeGeneratorPanel() {
  const {
    circuitGraph,
    equations,
    flipFlopType,
    initialStateBits,
    modelType,
    setGeneratedCircuitGraph,
    setTimingTrace,
    stateTable,
    timingTrace,
    variables,
    verification,
  } = useCircuitStore();
  const [activeTab, setActiveTab] = useState<CodeTabId>("behavioral");
  const [copied, setCopied] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [simulationResult, setSimulationResult] = useState<TestbenchSimulationResult | null>(null);
  const [simulationError, setSimulationError] = useState("");

  // Computes the circuit layout and a timing simulation headlessly so the
  // skipped verification checks can run without visiting the other tabs.
  function runVerification() {
    setVerifyError("");
    try {
      const layoutedGraph = layoutCircuitGraph(circuitGraph);
      if (layoutedGraph.metadata.validationErrors?.length) {
        throw new Error(`Circuit validation failed:\n${layoutedGraph.metadata.validationErrors.join("\n")}`);
      }
      const initialState = Object.fromEntries(
        variables.states.map((stateName, index) => [stateName, (initialStateBits[index] ?? "0") as "0" | "1"]),
      ) as Record<string, "0" | "1">;
      const timingData = generateTimingData(
        stateTable,
        modelType,
        flipFlopType,
        variables.states,
        variables.inputs,
        variables.outputs,
        buildDefaultInputSequence(variables.inputs),
        initialState,
      );
      setGeneratedCircuitGraph(layoutedGraph);
      setTimingTrace(timingData.steps);
    } catch (error) {
      setVerifyError(error instanceof Error ? error.message : "Verification failed.");
    }
  }
  const artifacts = useMemo(
    () =>
      buildCodeGeneratorArtifacts({
        equations,
        flipFlopType,
        modelType,
        stateTable,
        timingTrace,
        variables,
        verification,
      }),
    [equations, flipFlopType, modelType, stateTable, timingTrace, variables, verification],
  );
  const codeByTab: Record<CodeTabId, string> = {
    behavioral: artifacts.behavioralVerilog,
    gate: artifacts.gateLevelVerilog,
    testbench: artifacts.testbench,
  };
  const activeCode = codeByTab[activeTab];
  const canPreview = artifacts.isStateTableComplete && Boolean(activeCode);
  const canDownload = canPreview && artifacts.verificationStatus === "pass";
  const fsmDownloadCode = activeTab === "gate" ? artifacts.gateLevelVerilog : artifacts.behavioralVerilog;
  const simulationSignature = useMemo(
    () => JSON.stringify({ flipFlopType, initialStateBits, modelType, stateTable, timingTrace, variables }),
    [flipFlopType, initialStateBits, modelType, stateTable, timingTrace, variables],
  );

  useEffect(() => {
    setSimulationResult(null);
    setSimulationError("");
  }, [simulationSignature]);

  async function copyActiveCode() {
    if (!canPreview) return;
    try {
      await navigator.clipboard.writeText(activeCode);
    } catch {
      fallbackCopy(activeCode);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function runSimulation() {
    setSimulationError("");
    try {
      setSimulationResult(
        runTestbenchSimulation({
          stateTable,
          variables,
          modelType,
          flipFlopType,
          initialStateBits,
          timingTrace,
        }),
      );
    } catch (error) {
      setSimulationResult(null);
      setSimulationError(error instanceof Error ? error.message : "Simulation failed.");
    }
  }

  return (
    <section className="panel code-generator-panel">
      <div className="code-generator-header">
        <h2>Code Generator</h2>
        <span className={`code-status ${artifacts.verificationStatus}`}>{verificationLabel(artifacts.verificationStatus)}</span>
      </div>

      {!artifacts.isStateTableComplete ? <div className="code-generator-message">{artifacts.missingDataMessage}</div> : null}
      {artifacts.isStateTableComplete && artifacts.verificationStatus === "fail" ? (
        <div className="diagram-alert warning code-generator-alert">Warning: current design has verification errors. Generated code may be incorrect.</div>
      ) : null}
      {artifacts.isStateTableComplete && artifacts.verificationStatus === "pending" ? (
        <div className="diagram-alert warning code-generator-alert code-generator-alert-action">
          <span>
            Verification has not run yet: it compares the generated circuit and a timing simulation against your state
            table before code can be downloaded.
          </span>
          <button onClick={runVerification} type="button">
            <PlayCircle size={14} />
            Run Verification
          </button>
        </div>
      ) : null}
      {verifyError ? <div className="diagram-alert error code-generator-alert">{verifyError}</div> : null}

      {artifacts.isStateTableComplete ? (
        <>
          <div className="code-generator-interactive">
            <div className="code-tabs" role="tablist" aria-label="Code Generator Tabs">
              {tabs.map((tab) => (
                <button
                  aria-selected={activeTab === tab.id}
                  className={activeTab === tab.id ? "active" : ""}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  role="tab"
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === "testbench" ? (
              <div className="code-generator-testbench-layout">
                <VerilogCode className="code-block-embedded" code={activeCode} />
                <SimulationResultPanel
                  error={simulationError}
                  inputLabel={variables.inputs.join("") || "X"}
                  onRun={runSimulation}
                  outputLabel={variables.outputs.join("") || "Z"}
                  result={simulationResult}
                />
              </div>
            ) : (
              <VerilogCode code={activeCode} />
            )}
          </div>

          <div className="code-actions">
            <button disabled={!canPreview} onClick={copyActiveCode} type="button">
              <Clipboard size={15} />
              {copied ? "Copied" : "Copy Code"}
            </button>
            <button disabled={!canDownload || !fsmDownloadCode} onClick={() => downloadText("fsm.v", fsmDownloadCode)} type="button">
              <Download size={15} />
              Download fsm.v
            </button>
            <button disabled={!canDownload || !artifacts.testbench} onClick={() => downloadText("tb_fsm.v", artifacts.testbench)} type="button">
              <Download size={15} />
              Download tb_fsm.v
            </button>
          </div>

          <div className="code-generator-pdf-content">
            <h3>Behavioral Verilog</h3>
            <VerilogCode code={artifacts.behavioralVerilog} />
            <h3>Gate-Level Verilog</h3>
            <VerilogCode code={artifacts.gateLevelVerilog} />
            <h3>Testbench</h3>
            <VerilogCode code={artifacts.testbench} />
            <h3>Verification Result</h3>
            <p className="code-pdf-status">Status: {verificationLabel(artifacts.verificationStatus)}</p>
            <ul className="code-pdf-verification">
              {verification.checks.map((check) => (
                <li key={check.name}>
                  <strong>{check.name}</strong>: {check.skipped ? "SKIPPED" : check.passed ? "PASS" : "FAIL"} - {check.message}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </section>
  );
}
