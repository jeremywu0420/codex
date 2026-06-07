import { Formula } from "./EquationDisplay";
import { useCircuitStore } from "../store/useCircuitStore";

export function KMapViewer() {
  const { kMaps, equations } = useCircuitStore();
  const equationById = new Map(equations.map((equation) => [equation.id, equation]));

  return (
    <section className="panel output-panel">
      <h2>K-Maps</h2>
      <div className="kmap-scroll">
        <div className="kmap-grid">
          {kMaps.map((map) => {
            const equation = equationById.get(map.equationId);
            const columns = Math.max(...map.cells.map((cell) => cell.col)) + 1;
            return (
              <article className="kmap-card" key={map.equationId}>
                <header>
                  <strong>{equation ? <Formula text={equation.label} /> : null}</strong>
                  <Formula text={equation?.expression ?? ""} />
                </header>
                <div className="kmap" style={{ gridTemplateColumns: `repeat(${columns}, minmax(34px, 1fr))` }}>
                  {map.cells.map((cell) => (
                    <div className={`kmap-cell value-${cell.value === "-" ? "dc" : cell.value}`} key={cell.minterm}>
                      <small>m{cell.minterm}</small>
                      <span>{cell.value}</span>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
