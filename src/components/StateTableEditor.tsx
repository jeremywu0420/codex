import { useEffect, useState } from "react";
import type { LogicValue, StateTableRow } from "../types";
import { useCircuitStore } from "../store/useCircuitStore";

function nextLogicValue(value: LogicValue): LogicValue {
  if (value === "0") return "1";
  if (value === "1") return "-";
  return "0";
}

function patchNested(row: StateTableRow, section: "nextState" | "output", key: string) {
  return {
    [section]: {
      ...row[section],
      [key]: nextLogicValue(row[section][key]),
    },
  };
}

function parseVariableList(value: string, excluded: string[] = []) {
  const excludedSet = new Set(excluded);
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => /^[A-Za-z][A-Za-z0-9]*$/.test(item))
    .filter((item, index, items) => items.indexOf(item) === index && !excludedSet.has(item));
}

export function StateTableEditor() {
  const { modelType, variables, stateTable, setVariables, updateRow, updateMooreOutput } = useCircuitStore();
  const isMoore = modelType === "moore";
  const [inputDraft, setInputDraft] = useState(variables.inputs.join(", "));
  const [outputDraft, setOutputDraft] = useState(variables.outputs.join(", "));

  useEffect(() => {
    setInputDraft(variables.inputs.join(", "));
    setOutputDraft(variables.outputs.join(", "));
  }, [variables.inputs, variables.outputs]);

  function commitInputs() {
    const inputs = parseVariableList(inputDraft, [...variables.states, ...variables.outputs]);
    if (inputs.length) setVariables({ inputs });
    else setInputDraft(variables.inputs.join(", "));
  }

  function commitOutputs() {
    const outputs = parseVariableList(outputDraft, [...variables.states, ...variables.inputs]);
    if (outputs.length) setVariables({ outputs });
    else setOutputDraft(variables.outputs.join(", "));
  }

  return (
    <section className="control-block">
      <p className="control-title">3. State Table Input</p>
      <p className="model-note">
        {isMoore
          ? "Moore: output depends only on present state."
          : "Mealy: output depends on present state and input."}
      </p>
      <label className="field-label">Input variables</label>
      <input
        className="text-field"
        onBlur={commitInputs}
        onChange={(event) => setInputDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        value={inputDraft}
      />
      <label className="field-label">Output variables</label>
      <input
        className="text-field"
        onBlur={commitOutputs}
        onChange={(event) => setOutputDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        value={outputDraft}
      />
      <div className="table-wrap compact-table">
        <table>
          <thead>
            <tr>
              <th colSpan={variables.states.length}>Present State</th>
              {isMoore ? <th colSpan={variables.outputs.length}>Output</th> : null}
              <th colSpan={variables.inputs.length}>Input</th>
              <th colSpan={variables.states.length}>Next State</th>
              {!isMoore ? <th colSpan={variables.outputs.length}>Output</th> : null}
            </tr>
            <tr>
              {variables.states.map((state) => (
                <th key={`current-${state}`}>{state}</th>
              ))}
              {isMoore
                ? variables.outputs.map((output) => <th key={`moore-${output}`}>{output}</th>)
                : null}
              {variables.inputs.map((input) => (
                <th key={input}>{input}</th>
              ))}
              {variables.states.map((state) => (
                <th key={`next-${state}`}>{state}+</th>
              ))}
              {!isMoore
                ? variables.outputs.map((output) => <th key={`mealy-${output}`}>{output}</th>)
                : null}
            </tr>
          </thead>
          <tbody>
            {stateTable.map((row) => (
              <tr key={row.id}>
                {variables.states.map((state) => (
                  <td key={`${row.id}-current-${state}`}>{row.currentState[state]}</td>
                ))}
                {isMoore
                  ? variables.outputs.map((output) => (
                      <td key={`${row.id}-moore-output-${output}`}>
                        <button
                          className="bit-button moore-output"
                          onClick={() => updateMooreOutput(row.id, output, nextLogicValue(row.output[output]))}
                          title="Moore output is shared by all rows with the same present state."
                          type="button"
                        >
                          {row.output[output]}
                        </button>
                      </td>
                    ))
                  : null}
                {variables.inputs.map((input) => (
                  <td key={`${row.id}-input-${input}`}>{row.input[input]}</td>
                ))}
                {variables.states.map((state) => (
                  <td key={`${row.id}-next-${state}`}>
                    <button
                      className="bit-button"
                      onClick={() => updateRow(row.id, patchNested(row, "nextState", state))}
                      type="button"
                    >
                      {row.nextState[state]}
                    </button>
                  </td>
                ))}
                {!isMoore
                  ? variables.outputs.map((output) => (
                      <td key={`${row.id}-mealy-output-${output}`}>
                        <button
                          className="bit-button"
                          onClick={() => updateRow(row.id, patchNested(row, "output", output))}
                          type="button"
                        >
                          {row.output[output]}
                        </button>
                      </td>
                    ))
                  : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
