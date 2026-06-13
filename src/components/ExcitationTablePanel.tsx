import { useCircuitStore } from "../store/useCircuitStore";
import { Formula } from "./EquationDisplay";
import type { FlipFlopType, LogicValue } from "../types";

interface RuleRow {
  q: string;
  qNext: string;
  values: LogicValue[];
}

const ruleRowsByType: Record<FlipFlopType, RuleRow[]> = {
  d: [
    { q: "0", qNext: "0", values: ["0"] },
    { q: "0", qNext: "1", values: ["1"] },
    { q: "1", qNext: "0", values: ["0"] },
    { q: "1", qNext: "1", values: ["1"] },
  ],
  t: [
    { q: "0", qNext: "0", values: ["0"] },
    { q: "0", qNext: "1", values: ["1"] },
    { q: "1", qNext: "0", values: ["1"] },
    { q: "1", qNext: "1", values: ["0"] },
  ],
  jk: [
    { q: "0", qNext: "0", values: ["0", "-"] },
    { q: "0", qNext: "1", values: ["1", "-"] },
    { q: "1", qNext: "0", values: ["-", "1"] },
    { q: "1", qNext: "1", values: ["-", "0"] },
  ],
  sr: [
    { q: "0", qNext: "0", values: ["0", "-"] },
    { q: "0", qNext: "1", values: ["1", "0"] },
    { q: "1", qNext: "0", values: ["0", "1"] },
    { q: "1", qNext: "1", values: ["-", "0"] },
  ],
};

const rulePinsByType: Record<FlipFlopType, string[]> = {
  d: ["D"],
  t: ["T"],
  jk: ["J", "K"],
  sr: ["S", "R"],
};

function pinLabelsForRule(type: FlipFlopType, stateName: string): string[] {
  return rulePinsByType[type].map((pin) => `${pin}_${stateName}`);
}

function excitationValuesForRule(type: FlipFlopType, current: string, next: LogicValue): LogicValue[] {
  if (next === "-") return rulePinsByType[type].map(() => "-");
  return ruleRowsByType[type].find((rule) => rule.q === current && rule.qNext === next)?.values ?? rulePinsByType[type].map(() => "-");
}

export function ExcitationTablePanel() {
  const { flipFlopType, stateTable, variables } = useCircuitStore();
  const rulePins = rulePinsByType[flipFlopType];
  const ruleRows = ruleRowsByType[flipFlopType];
  const pinLabels = variables.states.flatMap((stateName) => pinLabelsForRule(flipFlopType, stateName));

  return (
    <section className="panel output-panel excitation-panel">
      <h2>
        Excitation Table ({flipFlopType.toUpperCase()} Flip-Flop)
        <span className="panel-hint">derived from state table via the excitation rule</span>
      </h2>

      <div className="excitation-layout">
        <div className="table-wrap excitation-main">
          <table>
            <thead>
              <tr>
                <th colSpan={variables.states.length}>Present State</th>
                <th colSpan={variables.inputs.length}>Input</th>
                <th colSpan={variables.states.length}>Next State</th>
                <th colSpan={pinLabels.length}>Flip-Flop Inputs</th>
              </tr>
              <tr>
                {variables.states.map((state) => (
                  <th key={`ps-${state}`}>{state}</th>
                ))}
                {variables.inputs.map((input) => (
                  <th key={`in-${input}`}>{input}</th>
                ))}
                {variables.states.map((state) => (
                  <th key={`ns-${state}`}>{state}+</th>
                ))}
                {pinLabels.map((label) => (
                  <th key={`pin-${label}`}>
                    <Formula text={label} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stateTable.map((row) => (
                <tr key={row.id}>
                  {variables.states.map((state) => (
                    <td key={`${row.id}-ps-${state}`}>{row.currentState[state]}</td>
                  ))}
                  {variables.inputs.map((input) => (
                    <td key={`${row.id}-in-${input}`}>{row.input[input]}</td>
                  ))}
                  {variables.states.map((state) => (
                    <td key={`${row.id}-ns-${state}`}>{row.nextState[state]}</td>
                  ))}
                  {variables.states.flatMap((state) => {
                    const values = excitationValuesForRule(flipFlopType, row.currentState[state], row.nextState[state]);
                    return pinLabelsForRule(flipFlopType, state).map((label, index) => (
                      <td className="excitation-cell" key={`${row.id}-${label}`}>
                        {values[index]}
                      </td>
                    ));
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="excitation-rule-card">
          <h3>{flipFlopType.toUpperCase()} Excitation Rule</h3>
          <table>
            <thead>
              <tr>
                <th>Q</th>
                <th>Q+</th>
                {rulePins.map((pin) => (
                  <th key={pin}>{pin}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ruleRows.map((rule) => (
                <tr key={`${rule.q}${rule.qNext}`}>
                  <td>{rule.q}</td>
                  <td>{rule.qNext}</td>
                  {rule.values.map((value, index) => (
                    <td key={`${rule.q}${rule.qNext}-${index}`}>{value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Each flip-flop input column is filled by looking up (Q, Q+) for that state bit in this rule table, then
            minimized with a K-map to produce the equations shown in the Boolean Expressions tab.
          </p>
        </aside>
      </div>
    </section>
  );
}
