import type { Bit, FlipFlopType, ModelType, StateTableRow } from "../types";

export type TimingValue = Bit | "X";

export interface TimingSignal {
  name: string;
  type?: "clock";
  values: TimingValue[];
}

export interface TimingData {
  signals: TimingSignal[];
  cycleCount: number;
  modelType: ModelType;
  outputNames: string[];
  steps: TimingStep[];
}

export interface TimingStep {
  step: number;
  currentState: Record<string, Bit>;
  input: Record<string, Bit>;
  nextState: Record<string, Bit>;
  output: Record<string, Bit>;
}

interface TimingLayoutOptions {
  cycleWidth?: number;
  labelWidth?: number;
  rowHeight?: number;
}

const completeMessage = "Please complete all state table values before generating timing diagram.";
const invalidMessage = "Timing diagram generation failed: invalid state table value.";

function isBit(value: unknown): value is Bit {
  return value === "0" || value === "1";
}

function requireBit(value: unknown): Bit {
  if (value === undefined || value === null || value === "" || value === "-") {
    throw new Error(completeMessage);
  }
  if (!isBit(value)) {
    throw new Error(invalidMessage);
  }
  return value;
}

function buildTimingKey(state: Record<string, Bit>, input: Record<string, Bit>, stateVars: string[], inputVars: string[]) {
  return [
    ...stateVars.map((stateName) => state[stateName]),
    ...inputVars.map((inputName) => input[inputName]),
  ].join("|");
}

function copyBitRecord(names: string[], source: Record<string, unknown>, sectionName: string) {
  return Object.fromEntries(
    names.map((name) => {
      try {
        return [name, requireBit(source[name])];
      } catch (error) {
        if (error instanceof Error && error.message === completeMessage) {
          throw new Error(`Please complete all ${sectionName} values before generating timing diagram.`);
        }
        throw error;
      }
    }),
  ) as Record<string, Bit>;
}

export function buildDefaultInputSequence(inputVars: string[], cycleCount = 8) {
  return Array.from({ length: cycleCount }, (_, step) =>
    Object.fromEntries(
      inputVars.map((inputName, inputIndex) => {
        const shift = Math.max(inputVars.length - inputIndex - 1, 0);
        const value = inputVars.length === 1 ? step % 2 : (step >> shift) & 1;
        return [inputName, value ? "1" : "0"];
      }),
    ) as Record<string, Bit>,
  );
}

export function parseTimingInputSequence(value: string, inputVars: string[]) {
  const tokens = value
    .split(/[,\s;]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (!tokens.length) {
    throw new Error("Please enter at least one timing input value.");
  }

  return tokens.map((token) => {
    if (!/^[01]+$/.test(token)) {
      throw new Error("Timing diagram generation failed: input sequence must contain only 0 or 1 values.");
    }
    if (token.length !== inputVars.length) {
      throw new Error(`Timing diagram generation failed: each input sequence item must contain ${inputVars.length} bit(s).`);
    }
    return Object.fromEntries(inputVars.map((inputName, index) => [inputName, token[index] as Bit])) as Record<string, Bit>;
  });
}

export function parseInputSequence(inputText: string, inputVars: string[]) {
  return parseTimingInputSequence(inputText, inputVars);
}

export function timingStepsToConsoleRows(steps: TimingStep[]) {
  return steps.map((step) => ({
    step: step.step,
    ...Object.fromEntries(Object.entries(step.currentState).map(([name, value]) => [`current${name}`, value])),
    ...Object.fromEntries(Object.entries(step.input).map(([name, value]) => [name.toLowerCase(), value])),
    ...Object.fromEntries(Object.entries(step.nextState).map(([name, value]) => [`next${name}`, value])),
    ...Object.fromEntries(Object.entries(step.output).map(([name, value]) => [name.toLowerCase(), value])),
  }));
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildDigitalWavePath(
  values: ReadonlyArray<Bit | 0 | 1>,
  x0: number,
  yHigh: number,
  yLow: number,
  cycleWidth: number,
) {
  if (!values.length) return "";

  const yFor = (value: Bit | 0 | 1) => (String(value) === "1" ? yHigh : yLow);
  let d = `M ${x0} ${yFor(values[0])}`;

  values.forEach((value, index) => {
    const xStart = x0 + index * cycleWidth;
    const xEnd = xStart + cycleWidth;
    const y = yFor(value);

    if (index > 0) {
      const previousY = yFor(values[index - 1]);
      if (previousY !== y) {
        d += ` L ${xStart} ${previousY} L ${xStart} ${y}`;
      }
    }

    d += ` L ${xEnd} ${y}`;
  });

  return d;
}

function buildClockPath(cycleCount: number, x0: number, yHigh: number, yLow: number, cycleWidth: number) {
  if (cycleCount <= 0) return "";

  let d = `M ${x0} ${yLow} L ${x0} ${yHigh}`;
  for (let index = 0; index < cycleCount; index += 1) {
    const xStart = x0 + index * cycleWidth;
    const xFall = xStart + cycleWidth / 2;
    const xEnd = x0 + (index + 1) * cycleWidth;
    d += ` L ${xFall} ${yHigh} L ${xFall} ${yLow} L ${xEnd} ${yLow}`;
    if (index < cycleCount - 1) {
      d += ` L ${xEnd} ${yHigh}`;
    }
  }

  return d;
}

export function generateTimingData(
  stateTableRows: StateTableRow[],
  modelType: ModelType,
  _flipFlopType: FlipFlopType,
  stateVars: string[],
  inputVars: string[],
  outputVars: string[],
  inputSequence: Record<string, Bit>[] = buildDefaultInputSequence(inputVars),
  initialState: Record<string, Bit> = Object.fromEntries(stateVars.map((stateName) => [stateName, "0"])) as Record<string, Bit>,
): TimingData {
  if (!stateTableRows.length) {
    throw new Error(completeMessage);
  }

  const signals: TimingSignal[] = [{ name: "Clock", type: "clock", values: [] }];
  const stateTableLookup = new Map<string, StateTableRow>();
  const currentState = copyBitRecord(stateVars, initialState, "initial state");
  const steps: TimingStep[] = [];

  for (const row of stateTableRows) {
    const rowState = copyBitRecord(stateVars, row.currentState, "present state");
    const rowInput = copyBitRecord(inputVars, row.input, "input");
    stateTableLookup.set(buildTimingKey(rowState, rowInput, stateVars, inputVars), row);
  }

  const inputSignals = Object.fromEntries(inputVars.map((inputName) => [inputName, [] as TimingValue[]]));
  const stateSignals = Object.fromEntries(stateVars.map((stateName) => [stateName, [] as TimingValue[]]));
  const outputSignals = Object.fromEntries(outputVars.map((outputName) => [outputName, [] as TimingValue[]]));

  inputSequence.forEach((inputFrame, stepIndex) => {
    const input = copyBitRecord(inputVars, inputFrame, "input sequence");
    const lookupKey = buildTimingKey(currentState, input, stateVars, inputVars);
    const row = stateTableLookup.get(lookupKey);
    if (!row) {
      const stateLabel = stateVars.map((stateName) => `${stateName}=${currentState[stateName]}`).join(", ");
      const inputLabel = inputVars.map((inputName) => `${inputName}=${input[inputName]}`).join(", ");
      throw new Error(`No matching state table row for ${[stateLabel, inputLabel].filter(Boolean).join(", ")}`);
    }

    const nextState = copyBitRecord(stateVars, row.nextState, "next state");
    const output = copyBitRecord(outputVars, row.output, "output");

    inputVars.forEach((inputName) => inputSignals[inputName].push(input[inputName]));
    stateVars.forEach((stateName) => stateSignals[stateName].push(currentState[stateName]));
    outputVars.forEach((outputName) => outputSignals[outputName].push(output[outputName]));

    steps.push({
      step: stepIndex,
      currentState: { ...currentState },
      input,
      nextState,
      output,
    });

    stateVars.forEach((stateName) => {
      currentState[stateName] = nextState[stateName];
    });
  });

  for (const inputName of inputVars) {
    signals.push({
      name: inputName,
      values: inputSignals[inputName],
    });
  }

  for (const stateName of stateVars) {
    signals.push({
      name: `Q${stateName}`,
      values: stateSignals[stateName],
    });
  }

  for (const outputName of outputVars) {
    signals.push({
      name: outputName,
      values: outputSignals[outputName],
    });
  }

  return {
    signals,
    cycleCount: inputSequence.length,
    modelType,
    outputNames: outputVars,
    steps,
  };
}

function renderUnknownSegment(x: number, yHigh: number, yLow: number, cycleWidth: number) {
  const yMiddle = (yHigh + yLow) / 2;
  const blockY = yHigh - 7;
  const blockHeight = yLow - yHigh + 14;
  return [
    `<rect x="${x}" y="${blockY}" width="${cycleWidth}" height="${blockHeight}" fill="#f8fafc" stroke="#cbd5e1" stroke-dasharray="5 4" />`,
    `<path d="M ${x + 8} ${yMiddle} L ${x + cycleWidth - 8} ${yMiddle}" fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="5 4" />`,
    `<text x="${x + cycleWidth / 2}" y="${yMiddle + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#64748b">X</text>`,
  ].join("");
}

function renderDigitalSignal(values: TimingValue[], x0: number, yHigh: number, yLow: number, cycleWidth: number) {
  const fragments: string[] = [];
  let runStart = 0;
  let runValues: Bit[] = [];

  function flushRun() {
    if (!runValues.length) return;
    const path = buildDigitalWavePath(runValues, x0 + runStart * cycleWidth, yHigh, yLow, cycleWidth);
    fragments.push(`<path d="${path}" fill="none" stroke="#0f172a" stroke-width="2.2" stroke-linejoin="miter" stroke-linecap="square" />`);
    runValues = [];
  }

  values.forEach((value, index) => {
    if (value === "X") {
      flushRun();
      fragments.push(renderUnknownSegment(x0 + index * cycleWidth, yHigh, yLow, cycleWidth));
      runStart = index + 1;
      return;
    }

    if (!runValues.length) runStart = index;
    runValues.push(value);
  });

  flushRun();
  return fragments.join("");
}

function renderStateAnnotationRow(steps: TimingStep[], x0: number, rowTop: number, cycleWidth: number, labelWidth: number) {
  if (!steps.length) return "";
  const boxHeight = 24;
  const boxY = rowTop + 8;
  const textY = boxY + boxHeight / 2 + 4;
  const fragments = [
    `<text x="${labelWidth - 14}" y="${textY}" text-anchor="end" font-size="14" font-weight="700" fill="#334155">State</text>`,
  ];
  steps.forEach((step, index) => {
    const x = x0 + index * cycleWidth;
    const bits = Object.values(step.currentState).join("");
    fragments.push(
      `<rect x="${x + 3}" y="${boxY}" width="${cycleWidth - 6}" height="${boxHeight}" rx="4" fill="#f1f5f9" stroke="#cbd5e1" />`,
      `<text x="${x + cycleWidth / 2}" y="${textY}" text-anchor="middle" font-size="13" font-weight="700" fill="#0f172a">${escapeXml(bits)}</text>`,
    );
  });
  return fragments.join("");
}

export function renderTimingDiagramSVG(data: TimingData, options: TimingLayoutOptions = {}) {
  const cycleWidth = options.cycleWidth ?? 80;
  const labelWidth = options.labelWidth ?? 104;
  const rowHeight = options.rowHeight ?? 48;
  const x0 = labelWidth + 24;
  const topPadding = 24;
  const rightPadding = 32;
  const bottomPadding = 24;
  const stateRowHeight = data.steps.length ? 40 : 0;
  const rowAreaBottom = topPadding + data.signals.length * rowHeight;
  const width = x0 + data.cycleCount * cycleWidth + rightPadding;
  const height = rowAreaBottom + stateRowHeight + bottomPadding;

  const rows = data.signals
    .map((signal, index) => {
      const rowTop = topPadding + index * rowHeight;
      const yHigh = rowTop + 13;
      const yLow = rowTop + 34;
      const labelY = rowTop + 29;
      const wavePath =
        signal.type === "clock"
          ? `<path d="${buildClockPath(data.cycleCount, x0, yHigh, yLow, cycleWidth)}" fill="none" stroke="#2563eb" stroke-width="2.2" stroke-linejoin="miter" stroke-linecap="square" />`
          : renderDigitalSignal(signal.values, x0, yHigh, yLow, cycleWidth);

      return [
        `<line x1="0" y1="${rowTop + rowHeight}" x2="${width}" y2="${rowTop + rowHeight}" stroke="#e2e8f0" stroke-width="1" />`,
        `<text x="${labelWidth - 14}" y="${labelY}" text-anchor="end" font-size="14" font-weight="700" fill="#334155">${escapeXml(signal.name)}</text>`,
        wavePath,
      ].join("");
    })
    .join("");

  const risingEdges = Array.from({ length: data.cycleCount }, (_, index) => {
    const x = x0 + index * cycleWidth;
    return `<line x1="${x}" y1="${topPadding - 8}" x2="${x}" y2="${rowAreaBottom + 8}" stroke="#64748b" stroke-width="1" stroke-dasharray="3 4" opacity="0.62" />`;
  }).join("");

  return [
    `<svg class="timing-svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Timing Diagram">`,
    `<title>Timing Diagram</title>`,
    `<rect width="${width}" height="${height}" fill="#ffffff" />`,
    `<rect x="0" y="0" width="${labelWidth}" height="${height}" fill="#f8fafc" />`,
    `<line x1="${labelWidth}" y1="0" x2="${labelWidth}" y2="${height}" stroke="#e2e8f0" stroke-width="1" />`,
    risingEdges,
    rows,
    `<line x1="${x0}" y1="${rowAreaBottom + 8}" x2="${x0 + data.cycleCount * cycleWidth}" y2="${rowAreaBottom + 8}" stroke="#e2e8f0" stroke-width="1" />`,
    renderStateAnnotationRow(data.steps, x0, rowAreaBottom, cycleWidth, labelWidth),
    `</svg>`,
  ].join("");
}
