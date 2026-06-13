// Component model: node sizes, pin/anchor positions and bounding boxes.
import type { CircuitBounds, CircuitNode } from "../../types";
import type { Point } from "./geometry";
import { ffHeight, ffWidth, obstaclePadding } from "./constants";

export type NodePins = {
  inputPins: Point[];
  outputPin?: Point;
  pins: Record<string, Point>;
};

export function gateSize(type: CircuitNode["type"]) {
  if (type === "OR") return { width: 86, height: 60 };
  if (type === "AND") return { width: 66, height: 44 };
  if (type === "NOT") return { width: 40, height: 30 };
  if (type === "FF") return { width: ffWidth, height: ffHeight };
  return { width: 1, height: 1 };
}

export function pinOffset(pin?: string) {
  if (pin === "K" || pin === "R") return 86;
  if (pin === "D" || pin === "T") return 63;
  return 42;
}

export function isGate(node?: CircuitNode) {
  return node?.type === "AND" || node?.type === "OR" || node?.type === "NOT";
}

export function metadataNumber(node: CircuitNode, key: string) {
  const value = node.metadata?.[key];
  return typeof value === "number" ? value : undefined;
}

function gateInputY(node: CircuitNode, inputIndex: number, inputCount: number) {
  const height = node.height ?? 0;
  if (node.type === "NOT") return node.y + height / 2;
  if (inputCount <= 1) return node.y + height / 2;
  if (inputCount === 2) return node.y + height * (inputIndex === 0 ? 0.35 : 0.65);
  const lane = (inputIndex + 1) / (inputCount + 1);
  return node.y + height * (0.2 + lane * 0.6);
}

export function getNodePins(node: CircuitNode, inputCount = 2): NodePins {
  const width = node.width ?? gateSize(node.type).width;
  const height = node.height ?? gateSize(node.type).height;
  if (node.type === "FF") {
    const inputX = node.x + 2;
    const outputX = node.x + ffWidth;
    return {
      inputPins: [
        { x: inputX, y: node.y + 42 },
        { x: inputX, y: node.y + 86 },
      ],
      outputPin: { x: outputX, y: node.y + 42 },
      pins: {
        J: { x: inputX, y: node.y + 42 },
        K: { x: inputX, y: node.y + 86 },
        S: { x: inputX, y: node.y + 42 },
        R: { x: inputX, y: node.y + 86 },
        D: { x: inputX, y: node.y + 63 },
        T: { x: inputX, y: node.y + 63 },
        Q: { x: outputX, y: node.y + 42 },
        "Q'": { x: outputX, y: node.y + 90 },
        Qbar: { x: outputX, y: node.y + 90 },
        CLK: { x: node.x + ffWidth / 2, y: node.y + ffHeight },
      },
    };
  }
  if (node.type === "AND" || node.type === "OR") {
    const inputX = node.x + 2;
    const inputPins = Array.from({ length: Math.max(1, inputCount) }, (_, index) => ({
      x: inputX,
      y: gateInputY(node, index, Math.max(1, inputCount)),
    }));
    const outputPin = { x: node.x + width, y: node.y + height / 2 };
    return { inputPins, outputPin, pins: { output: outputPin, out: outputPin } };
  }
  if (node.type === "NOT") {
    const inputPin = { x: node.x + 2, y: node.y + height / 2 };
    const outputPin = { x: node.x + width, y: node.y + height / 2 };
    return { inputPins: [inputPin], outputPin, pins: { input: inputPin, output: outputPin, out: outputPin } };
  }
  const anchor = { x: node.x, y: node.y };
  return { inputPins: [anchor], outputPin: anchor, pins: { input: anchor, output: anchor, out: anchor } };
}

export function outputAnchor(node: CircuitNode, fromPin?: string) {
  const pins = getNodePins(node);
  if (fromPin && pins.pins[fromPin]) return pins.pins[fromPin];
  return pins.outputPin ?? pins.pins.output;
}

export function inputAnchor(node: CircuitNode, toPin?: string, inputIndex = 0, inputCount = 1) {
  const pins = getNodePins(node, inputCount);
  if (toPin && pins.pins[toPin]) return pins.pins[toPin];
  if (node.type === "OUTPUT") return pins.pins.input;
  return pins.inputPins[Math.min(inputIndex, pins.inputPins.length - 1)] ?? pins.pins.input;
}

function labelBounds(node: CircuitNode): CircuitBounds {
  const width = Math.max(12, node.label.length * 8);
  const explicitLabelX = typeof node.metadata?.labelX === "number" ? node.metadata.labelX : undefined;
  const explicitLabelY = typeof node.metadata?.labelY === "number" ? node.metadata.labelY : undefined;
  const x = explicitLabelX ?? node.x + 8;
  const y = explicitLabelY ?? node.y - 11;
  return { id: node.id, x, y, width, height: 14, padding: 0 };
}

export function getNodeBounds(node: CircuitNode): CircuitBounds {
  if (node.type === "AND" || node.type === "OR" || node.type === "NOT" || node.type === "FF") {
    return {
      id: node.id,
      x: node.x,
      y: node.y,
      width: node.width ?? gateSize(node.type).width,
      height: node.height ?? gateSize(node.type).height,
      padding: obstaclePadding,
    };
  }
  if (node.type === "STATE" || node.type === "STATE_NOT") {
    return { id: node.id, x: node.x, y: node.y, width: 1, height: 1, padding: 0 };
  }
  return labelBounds(node);
}
