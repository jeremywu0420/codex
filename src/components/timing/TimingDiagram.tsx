import { useMemo, useState } from "react";
import { WaveformRow } from "./WaveformRow";
import type { SimulationCycle } from "./useSimulation";
import type { Variables } from "../../types";

interface TimingDiagramProps {
  currentStep: number;
  cycles: SimulationCycle[];
  onSelectStep: (step: number) => void;
  variables: Variables;
}

const cycleWidth = 86;
const rowHeight = 48;
const topPadding = 26;
const bottomPadding = 36;

function bitAt(value: string, index: number) {
  return value[index] ?? "X";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function tooltipLines(cycle: SimulationCycle) {
  if (cycle.result === "fail") {
    return [
      `Step ${cycle.step}`,
      `X: ${cycle.inputBits}`,
      `Present: ${cycle.actualPresentState} / exp ${cycle.expectedPresentState}`,
      `Z: ${cycle.actualOutput} / exp ${cycle.expectedOutput}`,
      `Next: ${cycle.actualNextState} / exp ${cycle.expectedNextState}`,
      "Result: FAIL",
    ];
  }
  const lines = [
    `Step ${cycle.step}`,
    `X: ${cycle.inputBits}`,
    `Present State: ${cycle.actualPresentState}`,
    `Z: ${cycle.actualOutput}`,
    `Next State: ${cycle.actualNextState}`,
    `Result: ${cycle.result.toUpperCase()}`,
  ];
  return lines;
}

export function TimingDiagram({ currentStep, cycles, onSelectStep, variables }: TimingDiagramProps) {
  const [hoverStep, setHoverStep] = useState<number | null>(null);
  const stateBitCount = variables.states.length;
  const rows = useMemo(() => {
    const signalRows = [
      { color: "var(--signal-clk)", kind: "clock" as const, label: "CLK", values: [] as string[] },
      { color: "var(--signal-reset)", kind: "reset" as const, label: "reset", values: [] as string[] },
      { color: "var(--signal-digital)", kind: "digital" as const, label: variables.inputs.join("") || "X", values: cycles.map((cycle) => cycle.inputBits) },
      ...variables.states.map((_stateName, index) => ({
        color: "var(--signal-digital)",
        kind: "digital" as const,
        label: `Q${stateBitCount - index - 1}`,
        values: cycles.map((cycle) => bitAt(cycle.actualPresentState, index)),
      })),
      { color: "var(--debug-border)", kind: "bus" as const, label: "debug_state", values: cycles.map((cycle) => cycle.actualPresentState) },
      { color: "var(--signal-z)", kind: "digital" as const, label: variables.outputs.join("") || "Z", values: cycles.map((cycle) => cycle.actualOutput) },
    ];
    return signalRows;
  }, [cycles, stateBitCount, variables.inputs, variables.outputs, variables.states]);
  const width = Math.max(cycles.length, 1) * cycleWidth + 28;
  const height = topPadding + rows.length * rowHeight + bottomPadding;
  const currentX = currentStep * cycleWidth;
  const hoverCycle = hoverStep === null ? null : cycles[hoverStep] ?? null;
  const tooltipWidth = 206;
  const tooltipHeight = hoverCycle ? 28 + tooltipLines(hoverCycle).length * 17 : 0;
  const tooltipX = hoverStep === null ? 0 : clamp(hoverStep * cycleWidth + 12, 8, width - tooltipWidth - 8);
  const tooltipY = 8;

  return (
    <div className="interactive-timing-frame" style={{ minHeight: height }}>
      <div className="timing-label-rail" style={{ height }}>
        <div className="timing-label-gutter" style={{ height: topPadding }} />
        {rows.map((row) => (
          <div className="timing-signal-label" key={row.label} style={{ height: rowHeight }}>
            <span className="timing-signal-dot" style={{ background: row.color }} />
            <strong>{row.label}</strong>
          </div>
        ))}
      </div>
      <div className="timing-waveform-viewport">
        <svg
          aria-label="Interactive Timing Diagram"
          className="interactive-timing-svg"
          height={height}
          role="img"
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <style>
              {`
                .interactive-timing-svg {
                  --bg-waveform: #fbfdff;
                  --grid-major: #e5ebf3;
                  --grid-minor: #f2f6fb;
                  --signal-clk: #2563eb;
                  --signal-reset: #f59e0b;
                  --signal-digital: #334155;
                  --signal-z: #059669;
                  --cursor: #2563eb;
                  --cycle-highlight: #eaf3ff;
                  --pass-border: #22c55e;
                  --fail-border: #ef4444;
                  --debug-bg: #f1f5f9;
                  --debug-border: #cbd5e1;
                  --debug-text: #1f2937;
                }
              `}
            </style>
          </defs>
          <rect width={width} height={height} fill="var(--bg-waveform)" />

          {cycles.map((cycle, index) => {
            const x = index * cycleWidth;
            const isCurrent = index === currentStep;
            const isHovered = index === hoverStep;
            const color = cycle.result === "pass" ? "var(--pass-border)" : "var(--fail-border)";
            return (
              <g key={cycle.step}>
                <rect
                  x={x}
                  y={topPadding - 16}
                  width={cycleWidth}
                  height={height - topPadding + 4}
                  fill={isCurrent || isHovered ? "var(--cycle-highlight)" : "transparent"}
                  opacity={isCurrent ? 1 : isHovered ? 0.72 : 0}
                />
                <rect x={x + 8} y={topPadding - 12} width={cycleWidth - 16} height="5" rx="2.5" fill={color} opacity="0.78" />
                <line x1={x + cycleWidth / 2} x2={x + cycleWidth / 2} y1={topPadding - 16} y2={height - 18} stroke="var(--grid-minor)" />
                <line x1={x} x2={x} y1={topPadding - 16} y2={height - 18} stroke="var(--grid-major)" strokeDasharray="4 6" />
              </g>
            );
          })}

          {rows.map((row, index) => (
            <WaveformRow
              cycleCount={cycles.length}
              cycleWidth={cycleWidth}
              key={row.label}
              kind={row.kind}
              label={row.label}
              rowHeight={rowHeight}
              signalColor={row.color}
              values={row.values}
              width={width}
              y={topPadding + index * rowHeight}
            />
          ))}

          {cycles.map((cycle, index) => {
            const x = index * cycleWidth;
            return (
              <rect
                aria-label={`Select timing step ${cycle.step}`}
                className="timing-cycle-hitbox"
                fill="transparent"
                height={height - topPadding}
                key={`hitbox-${cycle.step}`}
                onClick={() => onSelectStep(index)}
                onMouseEnter={() => setHoverStep(index)}
                onMouseLeave={() => setHoverStep(null)}
                role="button"
                tabIndex={0}
                width={cycleWidth}
                x={x}
                y={topPadding - 16}
              />
            );
          })}

          <line x1={currentX} x2={currentX} y1={topPadding - 18} y2={height - 16} stroke="var(--cursor)" strokeWidth="2.2" />
          <polygon points={`${currentX - 6},${topPadding - 20} ${currentX + 6},${topPadding - 20} ${currentX},${topPadding - 9}`} fill="var(--cursor)" />

          {hoverCycle ? (
            <g pointerEvents="none">
              <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx="7" fill="#ffffff" stroke="#cbd5e1" opacity="0.98" />
              {tooltipLines(hoverCycle).map((line, index) => (
                <text
                  fill={line.includes("FAIL") ? "#b91c1c" : line.includes("PASS") ? "#047857" : "#1f2937"}
                  fontFamily="Cascadia Mono, Consolas, monospace"
                  fontSize="11"
                  key={line}
                  x={tooltipX + 10}
                  y={tooltipY + 20 + index * 17}
                >
                  {line}
                </text>
              ))}
            </g>
          ) : null}
        </svg>
      </div>
    </div>
  );
}
