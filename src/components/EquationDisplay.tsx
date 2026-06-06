import { useCircuitStore } from "../store/useCircuitStore";

export function Formula({ text }: { text: string }) {
  const parts = text.split(/(_[A-Za-z0-9]+)/g).filter(Boolean);
  return (
    <span className="formula">
      {parts.map((part, index) => {
        if (part.startsWith("_")) return <sub key={`${part}-${index}`}>{part.slice(1)}</sub>;
        return <span key={`${part}-${index}`}>{part}</span>;
      })}
    </span>
  );
}

export function EquationDisplay() {
  const equations = useCircuitStore((state) => state.equations);
  const states = useCircuitStore((state) => state.variables.states);
  const outputs = useCircuitStore((state) => state.variables.outputs);
  const flipFlopEquations = equations.filter((equation) => equation.label.includes("_"));
  const outputEquations = equations.filter((equation) => outputs.includes(equation.label));

  return (
    <section className="panel output-panel">
      <h2>Flip-Flop Input Equations and Outputs (Simplified)</h2>
      <p className="state-variable-line">State Variables: {states.join("  ")}</p>
      <table className="equation-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Input</th>
            <th>Equation</th>
          </tr>
        </thead>
        <tbody>
          {flipFlopEquations.map((equation) => (
            <tr key={equation.id}>
              <td>FF for {equation.label.split("_")[1]}</td>
              <td><Formula text={equation.label} /></td>
              <td><Formula text={`${equation.label} = ${equation.expression}`} /></td>
            </tr>
          ))}
          {outputEquations.map((equation) => (
            <tr key={equation.id}>
              <td>Output</td>
              <td><Formula text={equation.label} /></td>
              <td><Formula text={`${equation.label} = ${equation.expression}`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
