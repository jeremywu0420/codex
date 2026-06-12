import type { FlipFlopType, ModelType, StateTableRow, Variables } from "../types";

/** The portable design-file payload (also used for autosave and share links). */
export interface WorkspaceSnapshot {
  modelType: ModelType;
  flipFlopType: FlipFlopType;
  variables: Variables;
  stateTable: StateTableRow[];
  initialStateBits: string;
}

export interface DesignFile extends WorkspaceSnapshot {
  format: typeof DESIGN_FILE_FORMAT;
  version: number;
}

export const DESIGN_FILE_FORMAT = "sequential-circuit-studio";
export const DESIGN_FILE_VERSION = 1;
export const SHARE_HASH_PREFIX = "#design=";

const VALID_MODEL_TYPES = new Set<string>(["mealy", "moore"]);
const VALID_FLIP_FLOPS = new Set<string>(["jk", "t", "sr", "d"]);
const VARIABLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

function isValidNameList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((name) => typeof name === "string" && VARIABLE_NAME_PATTERN.test(name));
}

/**
 * Validates the raw shape of a parsed workspace/design object. State-table
 * rows are passed through as-is; the store re-normalizes them against the
 * variable lists, so malformed rows degrade to defaults instead of crashing.
 */
export function parseWorkspaceObject(parsed: unknown): WorkspaceSnapshot | null {
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Partial<DesignFile>;
  if (candidate.format !== undefined && candidate.format !== DESIGN_FILE_FORMAT) return null;
  if (typeof candidate.modelType !== "string" || !VALID_MODEL_TYPES.has(candidate.modelType)) return null;
  if (typeof candidate.flipFlopType !== "string" || !VALID_FLIP_FLOPS.has(candidate.flipFlopType)) return null;
  if (!candidate.variables || !isValidNameList(candidate.variables.inputs) || !isValidNameList(candidate.variables.outputs)) return null;
  if (!Array.isArray(candidate.stateTable)) return null;
  const initialStateBits = typeof candidate.initialStateBits === "string" && /^[01]+$/.test(candidate.initialStateBits)
    ? candidate.initialStateBits
    : "";
  return {
    modelType: candidate.modelType as ModelType,
    flipFlopType: candidate.flipFlopType as FlipFlopType,
    variables: {
      inputs: candidate.variables.inputs,
      states: ["A", "B"],
      outputs: candidate.variables.outputs,
      clock: "CLK",
    },
    stateTable: candidate.stateTable as StateTableRow[],
    initialStateBits,
  };
}

export function parseWorkspaceJson(text: string): WorkspaceSnapshot | null {
  try {
    return parseWorkspaceObject(JSON.parse(text));
  } catch {
    return null;
  }
}

export function workspaceToDesignFile(snapshot: WorkspaceSnapshot): DesignFile {
  return {
    format: DESIGN_FILE_FORMAT,
    version: DESIGN_FILE_VERSION,
    modelType: snapshot.modelType,
    flipFlopType: snapshot.flipFlopType,
    variables: snapshot.variables,
    stateTable: snapshot.stateTable,
    initialStateBits: snapshot.initialStateBits,
  };
}

export function serializeWorkspace(snapshot: WorkspaceSnapshot): string {
  return JSON.stringify(workspaceToDesignFile(snapshot), null, 2);
}

function toBase64Url(text: string) {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string) {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

/** Encodes a snapshot into a URL hash fragment for shareable links. */
export function encodeWorkspaceHash(snapshot: WorkspaceSnapshot): string {
  return `${SHARE_HASH_PREFIX}${toBase64Url(JSON.stringify(workspaceToDesignFile(snapshot)))}`;
}

export function decodeWorkspaceHash(hash: string): WorkspaceSnapshot | null {
  if (!hash.startsWith(SHARE_HASH_PREFIX)) return null;
  try {
    return parseWorkspaceJson(fromBase64Url(hash.slice(SHARE_HASH_PREFIX.length)));
  } catch {
    return null;
  }
}
