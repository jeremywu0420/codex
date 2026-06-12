import { describe, expect, it } from "vitest";
import {
  decodeWorkspaceHash,
  encodeWorkspaceHash,
  parseWorkspaceJson,
  serializeWorkspace,
} from "./workspace";
import type { WorkspaceSnapshot } from "./workspace";

const snapshot: WorkspaceSnapshot = {
  modelType: "mealy",
  flipFlopType: "d",
  variables: { inputs: ["X"], states: ["A", "B"], outputs: ["Z"], clock: "CLK" },
  stateTable: [
    {
      id: "s00-x0",
      currentState: { A: "0", B: "0" },
      input: { X: "0" },
      nextState: { A: "0", B: "1" },
      output: { Z: "0" },
    },
  ],
  initialStateBits: "00",
};

describe("workspace serialization", () => {
  it("round-trips through the design-file JSON format", () => {
    const restored = parseWorkspaceJson(serializeWorkspace(snapshot));
    expect(restored?.modelType).toBe("mealy");
    expect(restored?.flipFlopType).toBe("d");
    expect(restored?.variables.inputs).toEqual(["X"]);
    expect(restored?.stateTable).toHaveLength(1);
    expect(restored?.initialStateBits).toBe("00");
  });

  it("round-trips through the share-link hash", () => {
    const hash = encodeWorkspaceHash(snapshot);
    expect(hash.startsWith("#design=")).toBe(true);
    const restored = decodeWorkspaceHash(hash);
    expect(restored?.modelType).toBe("mealy");
    expect(restored?.stateTable).toHaveLength(1);
  });

  it("rejects malformed payloads", () => {
    expect(parseWorkspaceJson("not json")).toBeNull();
    expect(parseWorkspaceJson("{}")).toBeNull();
    expect(parseWorkspaceJson(JSON.stringify({ ...snapshot, modelType: "weird" }))).toBeNull();
    expect(parseWorkspaceJson(JSON.stringify({ ...snapshot, format: "other-tool" }))).toBeNull();
    expect(decodeWorkspaceHash("#design=%%%")).toBeNull();
    expect(decodeWorkspaceHash("#other")).toBeNull();
  });

  it("rejects invalid variable names", () => {
    const bad = { ...snapshot, variables: { ...snapshot.variables, inputs: ["1bad"] } };
    expect(parseWorkspaceJson(JSON.stringify(bad))).toBeNull();
  });
});
