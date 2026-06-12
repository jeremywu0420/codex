type WaveformRowKind = "bus" | "clock" | "digital" | "reset";

interface WaveformRowProps {
  cycleCount: number;
  cycleWidth: number;
  kind: WaveformRowKind;
  label: string;
  rowHeight: number;
  signalColor: string;
  values?: string[];
  width: number;
  y: number;
}

function bitY(value: string, yHigh: number, yLow: number) {
  return value === "1" ? yHigh : yLow;
}

function digitalPath(values: string[], x0: number, yHigh: number, yLow: number, cycleWidth: number) {
  if (!values.length) return "";
  let path = `M ${x0} ${bitY(values[0], yHigh, yLow)}`;
  values.forEach((value, index) => {
    const xStart = x0 + index * cycleWidth;
    const xEnd = xStart + cycleWidth;
    const y = bitY(value, yHigh, yLow);
    if (index > 0) {
      const previousY = bitY(values[index - 1], yHigh, yLow);
      if (previousY !== y) path += ` L ${xStart} ${previousY} L ${xStart} ${y}`;
    }
    path += ` L ${xEnd} ${y}`;
  });
  return path;
}

function clockPath(cycleCount: number, x0: number, yHigh: number, yLow: number, cycleWidth: number) {
  if (cycleCount <= 0) return "";
  let path = `M ${x0} ${yLow} L ${x0} ${yHigh}`;
  for (let index = 0; index < cycleCount; index += 1) {
    const xStart = x0 + index * cycleWidth;
    const xFall = xStart + cycleWidth / 2;
    const xEnd = xStart + cycleWidth;
    path += ` L ${xFall} ${yHigh} L ${xFall} ${yLow} L ${xEnd} ${yLow}`;
    if (index < cycleCount - 1) path += ` L ${xEnd} ${yHigh}`;
  }
  return path;
}

function resetPath(cycleCount: number, x0: number, yHigh: number, yLow: number, cycleWidth: number) {
  if (cycleCount <= 0) return "";
  return `M ${x0} ${yHigh} L ${x0 + cycleWidth * 0.42} ${yHigh} L ${x0 + cycleWidth * 0.42} ${yLow} L ${
    x0 + cycleCount * cycleWidth
  } ${yLow}`;
}

function isSingleBitValues(values: string[]) {
  return values.every((value) => value === "0" || value === "1");
}

export function WaveformRow({ cycleCount, cycleWidth, kind, label, rowHeight, signalColor, values = [], width, y }: WaveformRowProps) {
  const x0 = 0;
  const yHigh = y + 13;
  const yLow = y + 34;
  const rowBottom = y + rowHeight;
  const shouldDrawBus = kind === "bus" || !isSingleBitValues(values);

  return (
    <g>
      <title>{label}</title>
      <line x1="0" x2={width} y1={rowBottom} y2={rowBottom} stroke="var(--grid-major)" strokeWidth="1" />
      {kind === "clock" ? (
        <path d={clockPath(cycleCount, x0, yHigh, yLow, cycleWidth)} fill="none" stroke={signalColor} strokeWidth="2.2" />
      ) : null}
      {kind === "reset" ? (
        <path d={resetPath(cycleCount, x0, yHigh, yLow, cycleWidth)} fill="none" stroke={signalColor} strokeWidth="2.2" />
      ) : null}
      {kind === "digital" && !shouldDrawBus ? (
        <path d={digitalPath(values, x0, yHigh, yLow, cycleWidth)} fill="none" stroke={signalColor} strokeLinecap="square" strokeWidth="2.2" />
      ) : null}
      {shouldDrawBus
        ? values.map((value, index) => {
            const x = x0 + index * cycleWidth;
            return (
              <g key={`${label}-${index}-${value}`}>
                <rect x={x + 6} y={y + 11} width={cycleWidth - 12} height={26} rx="5" fill="var(--debug-bg)" stroke="var(--debug-border)" />
                <text x={x + cycleWidth / 2} y={y + 29} textAnchor="middle" fontSize="12" fontWeight="800" fill="var(--debug-text)">
                  {value}
                </text>
              </g>
            );
          })
        : null}
    </g>
  );
}
