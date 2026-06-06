import { describe, expect, it } from "vitest";
import { excitationFor } from "./flipFlop";

describe("excitationFor", () => {
  it("builds D flip-flop excitation", () => {
    expect(excitationFor("d", "0", "1")).toEqual(["1"]);
    expect(excitationFor("d", "1", "0")).toEqual(["0"]);
  });

  it("builds T flip-flop excitation", () => {
    expect(excitationFor("t", "0", "0")).toEqual(["0"]);
    expect(excitationFor("t", "1", "0")).toEqual(["1"]);
  });

  it("builds JK flip-flop excitation", () => {
    expect(excitationFor("jk", "0", "0")).toEqual(["0", "-"]);
    expect(excitationFor("jk", "1", "0")).toEqual(["-", "1"]);
  });

  it("builds SR flip-flop excitation", () => {
    expect(excitationFor("sr", "0", "1")).toEqual(["1", "0"]);
    expect(excitationFor("sr", "1", "1")).toEqual(["-", "0"]);
  });

  it("treats don't-care next states as don't-care excitation inputs", () => {
    expect(excitationFor("d", "0", "-")).toEqual(["-"]);
    expect(excitationFor("t", "1", "-")).toEqual(["-"]);
    expect(excitationFor("jk", "0", "-")).toEqual(["-", "-"]);
    expect(excitationFor("sr", "1", "-")).toEqual(["-", "-"]);
  });
});
