// Backwards-compatible entry point. The circuit diagram pipeline now lives in the
// focused modules under ./circuit (geometry, pins, routing, validation, junctions,
// render, layout). This re-export keeps existing import paths working.
export * from "./circuit";
