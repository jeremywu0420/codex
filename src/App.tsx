import { CircuitDiagram } from "./components/CircuitDiagram";
import { EquationDisplay } from "./components/EquationDisplay";
import { ExportButton } from "./components/ExportButton";
import { KMapViewer } from "./components/KMapViewer";
import { Selectors } from "./components/Selectors";
import { StateTableEditor } from "./components/StateTableEditor";
import { TimingDiagramPanel } from "./components/TimingDiagramPanel";
import { useCircuitStore } from "./store/useCircuitStore";

export default function App() {
  const { variables, modelType, flipFlopType } = useCircuitStore();

  return (
    <main id="report-root" className="app-shell">
      <header className="project-title">
        <h1>Final Project</h1>
      </header>

      <div className="app-window">
        <div className="window-bar">
          <span className="window-dot" />
          <strong>Sequential Circuit Design Automation System</strong>
          <span className="window-spacer" />
          <span>{modelType.toUpperCase()} Model</span>
          <span>{flipFlopType.toUpperCase()} Flip-Flop</span>
          <span>{variables.clock}</span>
        </div>

        <div className="workspace-grid">
          <aside className="sidebar">
            <Selectors />
            <StateTableEditor />
            <div className="sidebar-footer">
              <button className="ghost-button" type="button">Clear Table</button>
              <button className="ghost-button" type="button">Load Example</button>
            </div>
          </aside>

          <section className="output-column">
            <div className="output-tab">OUTPUT 1: K-MAPS AND SIMPLIFIED EQUATIONS</div>
            <KMapViewer />
            <EquationDisplay />
          </section>

          <section className="diagram-column">
            <div className="output-tab output-tab-actions">
              <span>OUTPUT 2: SEQUENTIAL CIRCUIT DIAGRAM</span>
              <ExportButton />
            </div>
            <CircuitDiagram />
            <div className="output-tab">OUTPUT 3: TIMING DIAGRAM / CLOCK WAVEFORM</div>
            <TimingDiagramPanel />
          </section>
        </div>
      </div>
    </main>
  );
}
