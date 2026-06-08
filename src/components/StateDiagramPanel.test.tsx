import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderStateDiagram } from "./StateDiagramPanel";
import type { Bit, LogicValue, StateTableRow } from "../types";

function bit(value: string): Bit {
  return value === "1" ? "1" : "0";
}

function logicValue(value: string): LogicValue {
  return value === "1" ? "1" : "0";
}

function row(id: string, current: string, input: string, next: string, output: string): StateTableRow {
  return {
    id,
    currentState: { A: bit(current[0]), B: bit(current[1]) },
    input: { X: bit(input) },
    nextState: { A: logicValue(next[0]), B: logicValue(next[1]) },
    output: { Z: logicValue(output) },
  };
}

function mooreRows(): StateTableRow[] {
  return [
    row("00-0", "00", "0", "01", "0"),
    row("00-1", "00", "1", "10", "0"),
    row("01-0", "01", "0", "00", "0"),
    row("01-1", "01", "1", "11", "0"),
    row("10-0", "10", "0", "11", "1"),
    row("10-1", "10", "1", "01", "1"),
    row("11-0", "11", "0", "00", "1"),
    row("11-1", "11", "1", "10", "1"),
  ];
}

function boxesOverlap(first: { left: number; right: number; top: number; bottom: number }, second: { left: number; right: number; top: number; bottom: number }) {
  return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
}

function quadraticPoint(start: { x: number; y: number }, control: { x: number; y: number }, end: { x: number; y: number }, time: number) {
  const inverse = 1 - time;
  return {
    x: inverse * inverse * start.x + 2 * inverse * time * control.x + time * time * end.x,
    y: inverse * inverse * start.y + 2 * inverse * time * control.y + time * time * end.y,
  };
}

function cubicPoint(
  start: { x: number; y: number },
  controlOne: { x: number; y: number },
  controlTwo: { x: number; y: number },
  end: { x: number; y: number },
  time: number,
) {
  const inverse = 1 - time;
  return {
    x:
      inverse * inverse * inverse * start.x +
      3 * inverse * inverse * time * controlOne.x +
      3 * inverse * time * time * controlTwo.x +
      time * time * time * end.x,
    y:
      inverse * inverse * inverse * start.y +
      3 * inverse * inverse * time * controlOne.y +
      3 * inverse * time * time * controlTwo.y +
      time * time * time * end.y,
  };
}

function minDistanceToPath(label: { x: number; y: number }, path: string) {
  const values = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const samples = Array.from({ length: 41 }, (_, index) => index / 40);
  const points = samples.map((time) => {
    if (values.length === 6) {
      return quadraticPoint(
        { x: values[0], y: values[1] },
        { x: values[2], y: values[3] },
        { x: values[4], y: values[5] },
        time,
      );
    }
    return cubicPoint(
      { x: values[0], y: values[1] },
      { x: values[2], y: values[3] },
      { x: values[4], y: values[5] },
      { x: values[6], y: values[7] },
      time,
    );
  });
  return Math.min(...points.map((point) => Math.hypot(label.x - point.x, label.y - point.y)));
}

describe("state diagram rendering", () => {
  it("keeps Moore transition labels close to their edges and below node text", () => {
    const markup = renderToStaticMarkup(renderStateDiagram(mooreRows(), "moore"));
    const nodeBoxes = [...markup.matchAll(/<circle class="state-node" cx="([^"]+)" cy="([^"]+)" r="([^"]+)"><\/circle>/g)].map((match) => {
      const x = Number(match[1]);
      const y = Number(match[2]);
      const radius = Number(match[3]);
      return { left: x - radius, right: x + radius, top: y - radius, bottom: y + radius };
    });
    const paths = [...markup.matchAll(/<path class="state-edge" d="([^"]+)"/g)].map((match) => match[1]);
    const labelGroups = [...markup.matchAll(/<g class="state-edge-label-group" transform="translate\(([-\d.]+) ([-\d.]+)\)">([\s\S]*?)<\/g>/g)];

    expect(markup).not.toContain("/1");
    expect(markup).not.toContain("/0");
    expect(markup.indexOf('class="state-label-layer"')).toBeLessThan(markup.indexOf('class="nodes-layer state-node-layer"'));
    expect(labelGroups.length).toBeGreaterThan(0);
    expect(labelGroups).toHaveLength(paths.length);

    labelGroups.forEach((match, index) => {
      const x = Number(match[1]);
      const y = Number(match[2]);
      const width = Number(match[3].match(/width="([^"]+)"/)?.[1] ?? 0);
      const labelBox = { left: x - width / 2, right: x + width / 2, top: y - 11, bottom: y + 11 };
      expect(nodeBoxes.some((nodeBox) => boxesOverlap(labelBox, nodeBox)), `label at ${x},${y}`).toBe(false);
      expect(minDistanceToPath({ x, y }, paths[index]), `label at ${x},${y}`).toBeLessThanOrEqual(24);
    });
  });
});
