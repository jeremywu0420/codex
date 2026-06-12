import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Clipboard, Download } from "lucide-react";
import { buildCodeGeneratorArtifacts, type CodeTabId } from "../logic/codeGenerator";
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

function VerilogCode({ code }: { code: string }) {
  const highlighted = useMemo(() => highlightVerilog(code), [code]);
  return (
    <pre className="code-block">
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

export function CodeGeneratorPanel() {
  const { equations, flipFlopType, modelType, stateTable, timingTrace, variables, verification } = useCircuitStore();
  const [activeTab, setActiveTab] = useState<CodeTabId>("behavioral");
  const [copied, setCopied] = useState(false);
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
        <div className="diagram-alert warning code-generator-alert">Please run verification before exporting code.</div>
      ) : null}

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

            <VerilogCode code={activeCode} />
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
