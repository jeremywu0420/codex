import type { ReactNode } from "react";
import type { LogicValue, ModelType, StateTableRow } from "../types";
import { useCircuitStore } from "../store/useCircuitStore";

interface Point {
  x: number;
  y: number;
}

interface DiagramNode extends Point {
  id: string;
  output: string;
}

interface DiagramTransition {
  key: string;
  source: string;
  target: string;
  labels: string[];
}

interface EdgeGeometry {
  labelNormal: Point;
  labelPosition: Point;
  labelTangent: Point;
  path: string;
}

interface RenderedEdge extends EdgeGeometry {
  key: string;
  label: string;
}

interface LabelBox {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

interface DiagramLayout {
  center: Point;
  height: number;
  nodes: DiagramNode[];
  width: number;
}

const FIXED_WIDTH = 420;
const FIXED_HEIGHT = 320;
const NODE_RADIUS = 36;
const REVERSE_EDGE_CURVE_OFFSET = 48;
const SINGLE_EDGE_CURVE_OFFSET = 24;
const LABEL_PATH_OFFSET = 18;
const LABEL_COLLISION_STEP = 12;
const LABEL_COLLISION_ATTEMPTS = 5;
const LABEL_VIEWBOX_MARGIN = 4;
const LABEL_HEIGHT = 22;
const FIXED_TWO_BIT_POSITIONS: Record<string, Point> = {
  "00": { x: 210, y: 70 },
  "01": { x: 80, y: 250 },
  "10": { x: 210, y: 180 },
  "11": { x: 340, y: 250 },
};

function orderedKeys<T>(record: Record<string, T> | undefined) {
  return record ? Object.keys(record) : [];
}

function formatBits(record: Record<string, LogicValue>, names: string[]) {
  const value = names.map((name) => record[name] ?? "-").join("");
  return value || "ε";
}

function hasBinaryValues(record: Record<string, LogicValue>, names: string[]) {
  return names.every((name) => record[name] === "0" || record[name] === "1");
}

function hasCompleteStateTable(rows: StateTableRow[], stateNames: string[], inputNames: string[], outputNames: string[]) {
  if (!rows.length || !stateNames.length || !outputNames.length) return false;

  return rows.every(
    (row) =>
      hasBinaryValues(row.currentState, stateNames) &&
      hasBinaryValues(row.input, inputNames) &&
      hasBinaryValues(row.nextState, stateNames) &&
      hasBinaryValues(row.output, outputNames),
  );
}

function buildNodes(rows: StateTableRow[], stateNames: string[], outputNames: string[]) {
  const nodes = new Map<string, DiagramNode>();
  for (const row of rows) {
    const id = formatBits(row.currentState, stateNames);
    if (nodes.has(id)) continue;
    nodes.set(id, {
      id,
      output: formatBits(row.output, outputNames),
      x: 0,
      y: 0,
    });
  }
  return Array.from(nodes.values());
}

function layoutNodes(nodes: DiagramNode[], stateBitCount: number): DiagramLayout {
  if (stateBitCount === 2 && nodes.every((node) => FIXED_TWO_BIT_POSITIONS[node.id])) {
    return {
      center: { x: FIXED_WIDTH / 2, y: FIXED_HEIGHT / 2 },
      height: FIXED_HEIGHT,
      nodes: nodes.map((node) => ({ ...node, ...FIXED_TWO_BIT_POSITIONS[node.id] })),
      width: FIXED_WIDTH,
    };
  }

  const size = Math.max(FIXED_WIDTH, Math.ceil((nodes.length * 92) / Math.PI) + 164);
  const center = { x: size / 2, y: size / 2 };
  const radius = Math.max(80, size / 2 - NODE_RADIUS - 76);
  return {
    center,
    height: size,
    nodes: nodes.map((node, index) => {
      const angle = -Math.PI / 2 + (index / nodes.length) * Math.PI * 2;
      return {
        ...node,
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      };
    }),
    width: size,
  };
}

function buildTransitions(rows: StateTableRow[], stateNames: string[], inputNames: string[], outputNames: string[], machineType: ModelType) {
  const transitions = new Map<string, DiagramTransition>();

  for (const row of rows) {
    const source = formatBits(row.currentState, stateNames);
    const target = formatBits(row.nextState, stateNames);
    const input = formatBits(row.input, inputNames);
    const output = formatBits(row.output, outputNames);
    const label = machineType === "moore" ? input : `${input}/${output}`;
    const key = transitionKey(source, target);
    const transition = transitions.get(key);

    if (transition) {
      if (!transition.labels.includes(label)) transition.labels.push(label);
    } else {
      transitions.set(key, { key, source, target, labels: [label] });
    }
  }

  return Array.from(transitions.values());
}

function transitionKey(source: string, target: string) {
  return `${source}->${target}`;
}

function detectReverseEdges(transitions: DiagramTransition[]) {
  const edgeKeys = new Set(transitions.map((transition) => transition.key));
  const reverseEdgeKeys = new Set<string>();

  for (const transition of transitions) {
    if (transition.source === transition.target) continue;
    if (edgeKeys.has(transitionKey(transition.target, transition.source))) {
      reverseEdgeKeys.add(transition.key);
    }
  }

  return reverseEdgeKeys;
}

function numberValue(value: number) {
  return Number(value.toFixed(2));
}

function pathPoint(point: Point) {
  return `${numberValue(point.x)} ${numberValue(point.y)}`;
}

function getUnitVector(source: Point, target: Point) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.hypot(dx, dy) || 1;
  return {
    distance,
    normal: { x: -dy / distance, y: dx / distance },
    unit: { x: dx / distance, y: dy / distance },
  };
}

function normalizeVector(point: Point, fallback: Point = { x: 0, y: -1 }) {
  const distance = Math.hypot(point.x, point.y);
  if (!distance) return fallback;
  return {
    x: point.x / distance,
    y: point.y / distance,
  };
}

function offsetPoint(point: Point, direction: Point, distance: number): Point {
  return {
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance,
  };
}

function midpoint(source: Point, target: Point): Point {
  return {
    x: (source.x + target.x) / 2,
    y: (source.y + target.y) / 2,
  };
}

function quadraticPoint(start: Point, control: Point, end: Point, time: number): Point {
  const inverse = 1 - time;
  return {
    x: inverse * inverse * start.x + 2 * inverse * time * control.x + time * time * end.x,
    y: inverse * inverse * start.y + 2 * inverse * time * control.y + time * time * end.y,
  };
}

function getCanonicalNormal(edge: DiagramTransition, source: DiagramNode, target: DiagramNode) {
  const canonicalSource = edge.source < edge.target ? source : target;
  const canonicalTarget = edge.source < edge.target ? target : source;
  return getUnitVector(canonicalSource, canonicalTarget).normal;
}

function getCurveOffset(edge: DiagramTransition, hasReverseEdge: boolean) {
  const offset = hasReverseEdge ? REVERSE_EDGE_CURVE_OFFSET : SINGLE_EDGE_CURVE_OFFSET;
  return edge.source < edge.target ? offset : -offset;
}

function computeLabelPosition(basePosition: Point, labelNormal: Point, offset = LABEL_PATH_OFFSET): Point {
  return offsetPoint(basePosition, labelNormal, offset);
}

function computeCurvedEdgePath(edge: DiagramTransition, source: DiagramNode, target: DiagramNode, hasReverseEdge: boolean): EdgeGeometry {
  const { unit, normal } = getUnitVector(source, target);
  const canonicalNormal = hasReverseEdge ? getCanonicalNormal(edge, source, target) : normal;
  const curveOffset = getCurveOffset(edge, hasReverseEdge);
  const labelNormal = normalizeVector({
    x: canonicalNormal.x * Math.sign(curveOffset || 1),
    y: canonicalNormal.y * Math.sign(curveOffset || 1),
  });
  const centerMidpoint = midpoint(source, target);
  const control = offsetPoint(centerMidpoint, canonicalNormal, curveOffset);
  const startDirection = normalizeVector(
    {
      x: control.x - source.x,
      y: control.y - source.y,
    },
    unit,
  );
  const endDirection = normalizeVector(
    {
      x: control.x - target.x,
      y: control.y - target.y,
    },
    { x: -unit.x, y: -unit.y },
  );
  const start = {
    x: source.x + startDirection.x * (NODE_RADIUS + 2),
    y: source.y + startDirection.y * (NODE_RADIUS + 2),
  };
  const end = {
    x: target.x + endDirection.x * (NODE_RADIUS + 4),
    y: target.y + endDirection.y * (NODE_RADIUS + 4),
  };
  const labelBase = quadraticPoint(start, control, end, 0.5);
  const labelTangent = normalizeVector(
    {
      x: end.x - start.x,
      y: end.y - start.y,
    },
    unit,
  );

  return {
    labelNormal,
    labelPosition: computeLabelPosition(labelBase, labelNormal),
    labelTangent,
    path: `M ${pathPoint(start)} Q ${pathPoint(control)} ${pathPoint(end)}`,
  };
}

function computeSelfLoopPath(node: DiagramNode, center: Point): EdgeGeometry {
  const outwardAngle = Math.atan2(node.y - center.y, node.x - center.x) || -Math.PI / 2;
  const unit = { x: Math.cos(outwardAngle), y: Math.sin(outwardAngle) };
  const normal = { x: -unit.y, y: unit.x };
  const startAngle = outwardAngle - 0.74;
  const endAngle = outwardAngle + 0.74;
  const start = {
    x: node.x + Math.cos(startAngle) * NODE_RADIUS,
    y: node.y + Math.sin(startAngle) * NODE_RADIUS,
  };
  const end = {
    x: node.x + Math.cos(endAngle) * (NODE_RADIUS + 2),
    y: node.y + Math.sin(endAngle) * (NODE_RADIUS + 2),
  };
  const loopDistance = NODE_RADIUS + 30;
  const controlOne = {
    x: node.x + unit.x * loopDistance - normal.x * 38,
    y: node.y + unit.y * loopDistance - normal.y * 38,
  };
  const controlTwo = {
    x: node.x + unit.x * loopDistance + normal.x * 38,
    y: node.y + unit.y * loopDistance + normal.y * 38,
  };
  const label = {
    x: node.x + unit.x * (NODE_RADIUS + 22),
    y: node.y + unit.y * (NODE_RADIUS + 22),
  };

  return {
    labelNormal: unit,
    labelPosition: label,
    labelTangent: normal,
    path: `M ${pathPoint(start)} C ${pathPoint(controlOne)} ${pathPoint(controlTwo)} ${pathPoint(end)}`,
  };
}

function computeEdgePath(
  edge: DiagramTransition,
  nodeById: Map<string, DiagramNode>,
  reverseEdgeKeys: Set<string>,
  layoutCenter: Point,
): RenderedEdge | null {
  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);
  if (!source || !target) return null;

  const geometry =
    edge.source === edge.target
      ? computeSelfLoopPath(source, layoutCenter)
      : computeCurvedEdgePath(edge, source, target, reverseEdgeKeys.has(edge.key));

  return {
    ...geometry,
    key: edge.key,
    label: edge.labels.join(", "),
  };
}

function labelWidth(label: string) {
  return Math.max(28, label.length * 7.5 + 14);
}

function getLabelBBox(label: string, position: Point): LabelBox {
  const width = labelWidth(label);
  return {
    bottom: position.y + LABEL_HEIGHT / 2,
    left: position.x - width / 2,
    right: position.x + width / 2,
    top: position.y - LABEL_HEIGHT / 2,
  };
}

function isOverlapping(first: LabelBox, second: LabelBox) {
  return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function keepLabelInsideViewBox(edge: RenderedEdge, position: Point, viewBox: Pick<DiagramLayout, "height" | "width">): Point {
  const width = labelWidth(edge.label);
  const halfWidth = width / 2;
  const halfHeight = LABEL_HEIGHT / 2;
  const minX = Math.min(halfWidth + LABEL_VIEWBOX_MARGIN, viewBox.width / 2);
  const maxX = Math.max(viewBox.width - halfWidth - LABEL_VIEWBOX_MARGIN, minX);
  const minY = Math.min(halfHeight + LABEL_VIEWBOX_MARGIN, viewBox.height / 2);
  const maxY = Math.max(viewBox.height - halfHeight - LABEL_VIEWBOX_MARGIN, minY);

  return {
    x: clamp(position.x, minX, maxX),
    y: clamp(position.y, minY, maxY),
  };
}

function hasLabelCollision(label: string, position: Point, placedBoxes: LabelBox[]) {
  const currentBox = getLabelBBox(label, position);
  return placedBoxes.some((placedBox) => isOverlapping(currentBox, placedBox));
}

function resolveLabelCollisions(edges: RenderedEdge[], viewBox: Pick<DiagramLayout, "height" | "width">) {
  const placedBoxes: LabelBox[] = [];

  return edges.map((edge) => {
    const labelNormal = normalizeVector(edge.labelNormal);
    const labelTangent = normalizeVector(edge.labelTangent, { x: -labelNormal.y, y: labelNormal.x });
    const originalPosition = keepLabelInsideViewBox(edge, edge.labelPosition, viewBox);
    let labelPosition = originalPosition;

    for (let attempt = 1; attempt <= LABEL_COLLISION_ATTEMPTS; attempt += 1) {
      if (!hasLabelCollision(edge.label, labelPosition, placedBoxes)) break;
      labelPosition = keepLabelInsideViewBox(
        edge,
        offsetPoint(originalPosition, labelNormal, LABEL_COLLISION_STEP * attempt),
        viewBox,
      );
    }

    if (hasLabelCollision(edge.label, labelPosition, placedBoxes)) {
      for (let attempt = 1; attempt <= LABEL_COLLISION_ATTEMPTS; attempt += 1) {
        const direction = attempt % 2 === 0 ? -1 : 1;
        const distance = LABEL_COLLISION_STEP * Math.ceil(attempt / 2);
        labelPosition = keepLabelInsideViewBox(
          edge,
          offsetPoint(labelPosition, labelTangent, direction * distance),
          viewBox,
        );
        if (!hasLabelCollision(edge.label, labelPosition, placedBoxes)) break;
      }
    }

    placedBoxes.push(getLabelBBox(edge.label, labelPosition));
    return {
      ...edge,
      labelPosition,
    };
  });
}

function renderEdgeLabel(label: string, position: Point, key: string) {
  const width = labelWidth(label);

  return (
    <g className="state-edge-label-group" key={key} transform={`translate(${numberValue(position.x)} ${numberValue(position.y)})`}>
      <rect className="state-edge-label-bg" height={LABEL_HEIGHT} rx="4" width={width} x={-width / 2} y={-LABEL_HEIGHT / 2} />
      <text className="state-edge-label" dominantBaseline="middle" textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

function renderEdge(edge: RenderedEdge) {
  return (
    <g key={edge.key}>
      <path className="state-edge" d={edge.path} markerEnd="url(#state-diagram-arrow)" />
    </g>
  );
}

function renderNode(node: DiagramNode, machineType: ModelType) {
  return (
    <g className="state-node-group" key={node.id}>
      <circle className="state-node" cx={node.x} cy={node.y} r={NODE_RADIUS} />
      {machineType === "moore" ? (
        <>
          <text className="state-node-text" textAnchor="middle" x={node.x} y={node.y - 8}>
            {node.id}
          </text>
          <line className="state-node-divider" x1={node.x - 19} x2={node.x + 19} y1={node.y + 2} y2={node.y + 2} />
          <text className="state-node-text" textAnchor="middle" x={node.x} y={node.y + 26}>
            {node.output}
          </text>
        </>
      ) : (
        <text className="state-node-text state-node-text-single" dominantBaseline="middle" textAnchor="middle" x={node.x} y={node.y}>
          {node.id}
        </text>
      )}
    </g>
  );
}

export function renderStateDiagram(stateTable: StateTableRow[], machineType: ModelType): ReactNode {
  const firstRow = stateTable[0];
  const stateNames = orderedKeys(firstRow?.currentState);
  const inputNames = orderedKeys(firstRow?.input);
  const outputNames = orderedKeys(firstRow?.output);

  if (!hasCompleteStateTable(stateTable, stateNames, inputNames, outputNames)) {
    return <div className="state-diagram-placeholder">Please complete the state table first.</div>;
  }

  const layout = layoutNodes(buildNodes(stateTable, stateNames, outputNames), stateNames.length);
  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
  const transitions = buildTransitions(stateTable, stateNames, inputNames, outputNames, machineType);
  const reverseEdgeKeys = detectReverseEdges(transitions);
  const renderedEdges = resolveLabelCollisions(
    transitions
      .map((edge) => computeEdgePath(edge, nodeById, reverseEdgeKeys, layout.center))
      .filter((edge): edge is RenderedEdge => Boolean(edge)),
    layout,
  );

  return (
    <svg
      aria-label={`State Diagram (${machineType === "moore" ? "Moore" : "Mealy"})`}
      className="state-diagram-svg"
      height={layout.height}
      role="img"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width={layout.width}
    >
      <defs>
        <marker id="state-diagram-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="8" refY="4" viewBox="0 0 8 8">
          <path className="state-edge-marker" d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
      </defs>
      <g className="edges-layer state-edge-layer">{renderedEdges.map(renderEdge)}</g>
      <g className="nodes-layer state-node-layer">{layout.nodes.map((node) => renderNode(node, machineType))}</g>
      <g className="labels-layer state-label-layer">
        {renderedEdges.map((edge) => renderEdgeLabel(edge.label, edge.labelPosition, `${edge.key}-label`))}
      </g>
    </svg>
  );
}

export function StateDiagramPanel() {
  const modelType = useCircuitStore((state) => state.modelType);
  const stateTable = useCircuitStore((state) => state.stateTable);
  const flipFlopType = useCircuitStore((state) => state.flipFlopType);

  return (
    <section className="panel state-diagram-panel" data-flip-flop-type={flipFlopType}>
      <h2>State Diagram ({modelType === "moore" ? "Moore" : "Mealy"})</h2>
      <div className="state-diagram-scroll">{renderStateDiagram(stateTable, modelType)}</div>
    </section>
  );
}
