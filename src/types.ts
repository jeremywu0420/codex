export type ModelType = "mealy" | "moore";
export type FlipFlopType = "jk" | "t" | "sr" | "d";
export type Bit = "0" | "1";
export type LogicValue = Bit | "-";

export interface Variables {
  inputs: string[];
  states: string[];
  outputs: string[];
  clock: string;
}

export interface StateTableRow {
  id: string;
  currentState: Record<string, Bit>;
  input: Record<string, Bit>;
  nextState: Record<string, LogicValue>;
  output: Record<string, LogicValue>;
}

export interface Equation {
  id: string;
  label: string;
  variableNames: string[];
  minterms: number[];
  dontCares: number[];
  expression: string;
}

export interface KMapCell {
  row: number;
  col: number;
  label: string;
  minterm: number;
  value: LogicValue;
}

export interface KMapGroup {
  id: string;
  cells: number[];
  term: string;
}

export interface KMapModel {
  equationId: string;
  rowVariables: string[];
  colVariables: string[];
  rowLabels: string[];
  colLabels: string[];
  cells: KMapCell[];
  groups: KMapGroup[];
}

export type CircuitNodeType = "INPUT" | "OUTPUT" | "STATE" | "STATE_NOT" | "AND" | "OR" | "NOT" | "FF";

export interface CircuitNode {
  id: string;
  type: CircuitNodeType;
  label: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  flipFlopType?: FlipFlopType;
  pin?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface CircuitEdge {
  from: string;
  to: string;
  id?: string;
  label?: string;
  netId?: string;
  fromPin?: string;
  toPin?: string;
  points?: number[];
  sourceAnchor?: CircuitPoint;
  targetAnchor?: CircuitPoint;
  wireId?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface CircuitPoint {
  x: number;
  y: number;
}

export interface CircuitBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  padding?: number;
}

export interface CircuitClockLine {
  label: string;
  points: number[];
  branches: number[][];
}

export interface CircuitGraph {
  nodes: CircuitNode[];
  edges: CircuitEdge[];
  clockLine: CircuitClockLine;
  metadata: {
    width: number;
    height: number;
    flipFlopType: FlipFlopType;
    stateVariables: string[];
    inputVariables: string[];
    outputVariables: string[];
    generatedAt?: string;
    routingBounds?: CircuitBounds[];
    validationErrors?: string[];
  };
}
