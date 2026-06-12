import { Suspense, lazy, useEffect, useState } from "react";
import { CircuitBoard, Eraser, FlaskConical, Moon, Redo2, RotateCcw, Sun, Undo2 } from "lucide-react";
import { CodeGeneratorPanel } from "./components/CodeGeneratorPanel";
import { EquationDisplay } from "./components/EquationDisplay";
import { ExcitationTablePanel } from "./components/ExcitationTablePanel";
import { ExportButton } from "./components/ExportButton";
import { KMapViewer } from "./components/KMapViewer";
import { Selectors } from "./components/Selectors";
import { StateDiagramPanel } from "./components/StateDiagramPanel";
import { StateTableEditor } from "./components/StateTableEditor";
import { TimingDiagramPanel } from "./components/TimingDiagramPanel";
import { ValidationPanel } from "./components/ValidationPanel";
import { examplePresets } from "./examples";
import { useCircuitStore } from "./store/useCircuitStore";

// The circuit diagram pulls in konva/react-konva (~300 kB); split it into its own chunk.
const CircuitDiagram = lazy(() =>
  import("./components/CircuitDiagram").then((module) => ({ default: module.CircuitDiagram })),
);

const THEME_STORAGE_KEY = "scs-theme";

type TabId = "state" | "excitation" | "boolean" | "circuit" | "timing" | "verilog" | "validation";

const tabs: { id: TabId; label: string }[] = [
  { id: "state", label: "State Diagram" },
  { id: "excitation", label: "Excitation & K-Maps" },
  { id: "boolean", label: "Boolean Expressions" },
  { id: "circuit", label: "Circuit Diagram" },
  { id: "timing", label: "Timing Diagram" },
  { id: "verilog", label: "Verilog Code" },
  { id: "validation", label: "Validation" },
];

function loadInitialTheme(): "light" | "dark" {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export default function App() {
  const { variables, modelType, flipFlopType, lint, verification, history, future, loadExample, clearTable, resetAll, undo, redo } =
    useCircuitStore();
  const [activeTab, setActiveTab] = useState<TabId>("state");
  const [selectedExample, setSelectedExample] = useState(examplePresets[0].id);
  const [theme, setTheme] = useState<"light" | "dark">(loadInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // storage failures must not break theming
    }
  }, [theme]);

  const validationCount = lint.errorCount + lint.warningCount + (verification.passed ? 0 : 1);

  return (
    <main id="report-root" className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <span className="app-logo">
            <CircuitBoard size={22} />
          </span>
          <div>
            <h1>Sequential Circuit Studio</h1>
            <p>State table → diagrams, equations, circuit, timing and Verilog — fully client-side.</p>
          </div>
        </div>
        <div className="app-header-meta">
          <span className="meta-chip">{modelType === "moore" ? "Moore" : "Mealy"} model</span>
          <span className="meta-chip">{flipFlopType.toUpperCase()} flip-flop</span>
          <span className="meta-chip">{variables.clock}</span>
          <button
            aria-label="Toggle color theme"
            className="icon-button"
            onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            type="button"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <ExportButton />
        </div>
      </header>

      <div className="workspace-grid">
        <aside className="sidebar">
          <Selectors />
          <StateTableEditor />

          <section className="control-block sidebar-actions">
            <p className="control-title">4. Examples & Actions</p>
            <div className="example-row">
              <select
                aria-label="Example preset"
                className="text-field"
                onChange={(event) => setSelectedExample(event.target.value)}
                value={selectedExample}
              >
                {examplePresets.map((example) => (
                  <option key={example.id} value={example.id}>
                    {example.name}
                  </option>
                ))}
              </select>
              <button className="action-button primary" onClick={() => loadExample(selectedExample)} type="button">
                <FlaskConical size={14} />
                Load
              </button>
            </div>
            <p className="model-note">{examplePresets.find((example) => example.id === selectedExample)?.description}</p>
            <div className="action-row">
              <button className="action-button" disabled={!history.length} onClick={undo} title="Undo" type="button">
                <Undo2 size={14} />
                Undo
              </button>
              <button className="action-button" disabled={!future.length} onClick={redo} title="Redo" type="button">
                <Redo2 size={14} />
                Redo
              </button>
              <button className="action-button" onClick={clearTable} title="Set every next state / output cell to don't care" type="button">
                <Eraser size={14} />
                Clear Table
              </button>
              <button className="action-button" onClick={resetAll} title="Restore the default design and clear saved data" type="button">
                <RotateCcw size={14} />
                Reset All
              </button>
            </div>
            <p className="autosave-note">Changes are saved to this browser automatically.</p>
          </section>
        </aside>

        <div className="main-workspace">
          <nav aria-label="Result tabs" className="result-tabs" role="tablist">
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
                {tab.id === "validation" && validationCount > 0 ? <span className="tab-badge">{validationCount}</span> : null}
              </button>
            ))}
          </nav>

          {/* Every panel stays mounted so generated diagrams survive tab switches and PDF export can capture them. */}
          <div className={`tab-panel ${activeTab === "state" ? "active" : ""}`} role="tabpanel">
            <StateDiagramPanel />
          </div>
          <div className={`tab-panel ${activeTab === "excitation" ? "active" : ""}`} role="tabpanel">
            <ExcitationTablePanel />
            <KMapViewer />
          </div>
          <div className={`tab-panel ${activeTab === "boolean" ? "active" : ""}`} role="tabpanel">
            <EquationDisplay />
          </div>
          <div className={`tab-panel ${activeTab === "circuit" ? "active" : ""}`} role="tabpanel">
            <Suspense fallback={<section className="panel"><div className="diagram-placeholder">Loading circuit renderer…</div></section>}>
              <CircuitDiagram />
            </Suspense>
          </div>
          <div className={`tab-panel ${activeTab === "timing" ? "active" : ""}`} role="tabpanel">
            <TimingDiagramPanel />
          </div>
          <div className={`tab-panel ${activeTab === "verilog" ? "active" : ""}`} role="tabpanel">
            <CodeGeneratorPanel />
          </div>
          <div className={`tab-panel ${activeTab === "validation" ? "active" : ""}`} role="tabpanel">
            <ValidationPanel />
          </div>
        </div>
      </div>
    </main>
  );
}
