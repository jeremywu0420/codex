import { describe, expect, it } from "vitest";
import { buildCircuitGraph } from "../circuitGraph";
import { layoutCircuitGraph } from "../circuitLayout";
import type { FlipFlopType, Variables } from "../../types";
import { toCircuitModel } from "./model";
import { evaluateNetValues, nextStateValues } from "./simulate";

function variables(states: string[]): Variables {
  return { inputs: ["X"], states, outputs: ["Z"], clock: "CLK" };
}

function buildAndLayout(flipFlopType: FlipFlopType, states: string[], equations: Record<string, string>) {
  return layoutCircuitGraph(buildCircuitGraph({ equations, flipFlopType, variables: variables(states) }));
}

describe("circuit view-model adapter", () => {
  it("projects edges into first-class wires with signal class, colour and bus flag", () => {
    const graph = buildAndLayout("d", ["A"], { D_A: "X", Z: "A" });
    const model = toCircuitModel(graph);

    expect(model.wires.length).toBe(graph.edges.length);
    const xWire = model.wires.find((wire) => wire.netId === "X");
    expect(xWire?.signalClass).toBe("input");
    const aWire = model.wires.find((wire) => wire.netId === "A");
    expect(aWire?.signalClass).toBe("state");
    for (const wire of model.wires) {
      expect(wire.from.nodeId).toBeTruthy();
      expect(wire.to.nodeId).toBeTruthy();
      expect(typeof wire.color).toBe("string");
      expect(typeof wire.isBus).toBe("boolean");
    }
  });
});

describe("signal value evaluation", () => {
  it("propagates input and state values to every net", () => {
    const graph = buildAndLayout("d", ["A"], { D_A: "X", Z: "A" });
    const values = evaluateNetValues(graph, { X: "1" }, { A: "0" });
    expect(values.get("X")).toBe("1");
    expect(values.get("A")).toBe("0");
  });

  it("evaluates a NOT/complement net", () => {
    const graph = buildAndLayout("d", ["A"], { D_A: "X'", Z: "A" });
    const values = evaluateNetValues(graph, { X: "1" }, { A: "0" });
    // X' net is "XNOT"
    expect(values.get("XNOT")).toBe("0");
  });

  it("computes next state for a D flip-flop", () => {
    const graph = buildAndLayout("d", ["A"], { D_A: "X", Z: "A" });
    const values = evaluateNetValues(graph, { X: "1" }, { A: "0" });
    expect(nextStateValues(graph, values, { A: "0" })).toEqual({ A: "1" });
  });

  it("computes next state for a JK flip-flop (toggle on J=K=1)", () => {
    const graph = buildAndLayout("jk", ["A"], { J_A: "X", K_A: "X", Z: "A" });
    const values = evaluateNetValues(graph, { X: "1" }, { A: "0" });
    // J=K=1 -> toggle 0 -> 1
    expect(nextStateValues(graph, values, { A: "0" })).toEqual({ A: "1" });
  });

  it("computes next state for a T flip-flop (hold on T=0)", () => {
    const graph = buildAndLayout("t", ["A"], { T_A: "X", Z: "A" });
    const values = evaluateNetValues(graph, { X: "0" }, { A: "1" });
    expect(nextStateValues(graph, values, { A: "1" })).toEqual({ A: "1" });
  });
});
