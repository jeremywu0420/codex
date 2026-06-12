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
  const { modelType, variables, stateTable, initialStateBits, setInitialState, setVariables, updateRow, updateMooreOutput } =
    useCircuitStore();
  const isMoore = modelType === "moore";
  const [inputDraft, setInputDraft] = useState(variables.inputs.join(", "));
  const [outputDraft, setOutputDraft] = useState(variables.outputs.join(", "));
  const [variableError, setVariableError] = useState("");

  useEffect(() => {
    setInputDraft(variables.inputs.join(", "));
    setOutputDraft(variables.outputs.join(", "));
  }, [variables.inputs, variables.outputs]);

  const stateCodes = Array.from({ length: 2 ** variables.states.length }, (_, index) =>
    index.toString(2).padStart(variables.states.length, "0"),
  );

  function commitInputs() {
    const inputs = parseVariableList(inputDraft, [...variables.states, ...variables.outputs]);
    if (inputs.length) {
      setVariableError("");
      setVariables({ inputs });
    } else {
      setVariableError(
        "Invalid input variables: use letters/digits starting with a letter, and avoid names already used by states or outputs.",
      );
      setInputDraft(variables.inputs.join(", "));
    }
  }

  function commitOutputs() {
    const outputs = parseVariableList(outputDraft, [...variables.states, ...variables.inputs]);
    if (outputs.length) {
      setVariableError("");
      setVariables({ outputs });
    } else {
      setVariableError(
        "Invalid output variables: use letters/digits starting with a letter, and avoid names already used by states or inputs.",
      );
      setOutputDraft(variables.outputs.join(", "));
    }
  }

  return (
    <section className="control-block">
      <p className="control-title">3. State Table Input</p>
      <p className="model-note">Click the Next State / Output cells to cycle 0 → 1 → − (don't care).</p>

      <div className="field-row">
        <div>
          <label className="field-label" htmlFor="input-variables">Input variables</label>
          <input
            className="text-field"
            id="input-variables"
            onBlur={commitInputs}
            onChange={(event) => setInputDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            value={inputDraft}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="output-variables">Output variables</label>
          <input
            className="text-field"
            id="output-variables"
            onBlur={commitOutputs}
            onChange={(event) => setOutputDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            value={outputDraft}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="initial-state">Initial state ({variables.states.join("")})</label>
          <select
            className="text-field"
            id="initial-state"
            onChange={(event) => setInitialState(event.target.value)}
            value={initialStateBits}
          >
            {stateCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      </div>

      {variableError ? <div className="diagram-alert error field-alert">{variableError}</div> : null}

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
