import { Formula } from "./EquationDisplay";
import { useCircuitStore } from "../store/useCircuitStore";
import type { KMapModel } from "../types";

const GROUP_COLORS = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2"];

function groupColor(index: number) {
  return GROUP_COLORS[index % GROUP_COLORS.length];
}

function KMapGrid({ map }: { map: KMapModel }) {
  const rowLabels = map.rowLabels;
  const colLabels = map.colLabels;
  const groupsByMinterm = new Map<number, number[]>();
  map.groups.forEach((group, groupIndex) => {
    for (const minterm of group.cells) {
      const list = groupsByMinterm.get(minterm) ?? [];
      list.push(groupIndex);
      groupsByMinterm.set(minterm, list);
    }
  });
  const cellByPosition = new Map(map.cells.map((cell) => [`${cell.row}:${cell.col}`, cell]));

  return (
    <table className="kmap-table">
      <thead>
        <tr>
          <th className="kmap-corner">
            <span className="kmap-corner-row">{map.rowVariables.join("") || "."}</span>
            <span className="kmap-corner-col">{map.colVariables.join("") || "."}</span>
          </th>
          {colLabels.map((label) => (
            <th key={`col-${label || "e"}`}>{label || "."}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rowLabels.map((rowLabel, rowIndex) => (
          <tr key={`row-${rowLabel || "e"}`}>
            <th>{rowLabel || "."}</th>
            {colLabels.map((_colLabel, colIndex) => {
              const cell = cellByPosition.get(`${rowIndex}:${colIndex}`);
              if (!cell) return <td key={`cell-${rowIndex}-${colIndex}`} />;
              const memberships = groupsByMinterm.get(cell.minterm) ?? [];
              const primaryGroup = memberships[0];
              const style =
                primaryGroup !== undefined
                  ? {
                      boxShadow: memberships
                        .slice(0, 2)
                        .map((groupIndex, depth) => `inset 0 0 0 ${2 + depth * 2}px ${groupColor(groupIndex)}55`)
                        .join(", "),
                    }
                  : undefined;
              return (
                <td
                  className={`kmap-cell value-${cell.value === "-" ? "dc" : cell.value}`}
                  key={`cell-${cell.minterm}`}
                  style={style}
                  title={`m${cell.minterm}${memberships.length ? ` - ${memberships.map((index) => map.groups[index].term).join(", ")}` : ""}`}
                >
                  <small>m{cell.minterm}</small>
                  <span>{cell.value}</span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function KMapViewer() {
  const { kMaps, equations } = useCircuitStore();
  const equationById = new Map(equations.map((equation) => [equation.id, equation]));

  return (
    <section className="panel output-panel">
      <h2>
        K-Maps
        <span className="panel-hint">gray-code headers - colored rings mark each product term</span>
      </h2>
      <div className="kmap-grid">
        {kMaps.map((map) => {
          const equation = equationById.get(map.equationId);
          return (
            <article className="kmap-card" key={map.equationId}>
              <header className="kmap-card-header">
                <div className="kmap-card-title">
                  <span className="kmap-section-label">Equation</span>
                  <strong>{equation ? <Formula text={equation.label} /> : null}</strong>
                </div>
                <div className="kmap-expression">
                  <span className="kmap-section-label">Formula</span>
                  <Formula text={equation?.expression ?? ""} />
                </div>
              </header>
              <div className="kmap-table-scroll">
                <KMapGrid map={map} />
              </div>
              {map.groups.length ? (
                <div className="kmap-legend-block">
                  <span className="kmap-section-label">Legend</span>
                  <ul className="kmap-legend">
                    {map.groups.map((group, index) => (
                      <li key={group.id}>
                        <span className="kmap-legend-swatch" style={{ background: groupColor(index) }} />
                        <Formula text={group.term} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
