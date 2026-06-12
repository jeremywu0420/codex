import { useRef } from "react";
import type { ReactNode } from "react";
import { exportSvgAsPng, exportSvgFile } from "../export/timing";
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
  labelCandidates: LabelCandidate[];
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

interface LabelCandidate {
  edgePoint: Point;
  offset: number;
  position: Point;
  priority: number;
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
const REVERSE_EDGE_CURVE_OFFSET = 64;
const SINGLE_EDGE_CURVE_OFFSET = 30;
const LABEL_PATH_OFFSET = 18;
const LABEL_VIEWBOX_MARGIN = 4;
const LABEL_HEIGHT = 22;
const NODE_LABEL_CLEARANCE = 8;
const LABEL_TIME_CANDIDATES = [0.5, 0.44, 0.56, 0.38, 0.62, 0.35, 0.65];
const LABEL_OFFSET_CANDIDATES = [14, 18, 10, 20];
const SELF_LOOP_LABEL_OFFSET_CANDIDATES = [8, 12, 16, 20];
// Symmetric square layout (Gray-code order around the square) keeps the
// diagram stable across regenerations and leaves room for edge labels.
const FIXED_TWO_BIT_POSITIONS: Record<string, Point> = {
  "00": { x: 116, y: 88 },
  "01": { x: 304, y: 88 },
  "11": { x: 304, y: 232 },
  "10": { x: 116, y: 232 },
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

function cubicPoint(start: Point, controlOne: Point, controlTwo: Point, end: Point, time: number): Point {
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

function makeLabelCandidate(edgePoint: Point, normal: Point, offset: number, priority: number): LabelCandidate {
  return {
    edgePoint,
    offset,
    position: computeLabelPosition(edgePoint, normal, offset),
    priority,
  };
}

function candidateDistance(candidate: LabelCandidate) {
  return Math.hypot(candidate.position.x - candidate.edgePoint.x, candidate.position.y - candidate.edgePoint.y);
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
  const labelCandidates = LABEL_TIME_CANDIDATES.flatMap((time, timeIndex) =>
    LABEL_OFFSET_CANDIDATES.flatMap((offset, offsetIndex) =>
      [
        makeLabelCandidate(quadraticPoint(start, control, end, time), labelNormal, offset, timeIndex * 10 + offsetIndex),
        makeLabelCandidate(
          quadraticPoint(start, control, end, time),
          { x: -labelNormal.x, y: -labelNormal.y },
          offset,
          100 + timeIndex * 10 + offsetIndex,
        ),
      ],
    ),
  );

  return {
    labelCandidates,
    labelNormal,
    labelPosition: labelCandidates[0]?.position ?? computeLabelPosition(labelBase, labelNormal),
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
  const labelBase = cubicPoint(start, controlOne, controlTwo, end, 0.5);
  const labelCandidates = LABEL_TIME_CANDIDATES.flatMap((time, timeIndex) =>
    SELF_LOOP_LABEL_OFFSET_CANDIDATES.map((offset, offsetIndex) =>
      makeLabelCandidate(cubicPoint(start, controlOne, controlTwo, end, time), unit, offset, timeIndex * 10 + offsetIndex),
    ),
  );

  return {
    labelCandidates,
    labelNormal: unit,
    labelPosition: labelCandidates[0]?.position ?? computeLabelPosition(labelBase, unit),
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

function getNodeBBox(node: DiagramNode): LabelBox {
  return {
    bottom: node.y + NODE_RADIUS + NODE_LABEL_CLEARANCE,
    left: node.x - NODE_RADIUS - NODE_LABEL_CLEARANCE,
    right: node.x + NODE_RADIUS + NODE_LABEL_CLEARANCE,
    top: node.y - NODE_RADIUS - NODE_LABEL_CLEARANCE,
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

function overlapArea(first: LabelBox, second: LabelBox) {
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  return width * height;
}

function totalOverlapArea(box: LabelBox, boxes: LabelBox[]) {
  return boxes.reduce((sum, candidate) => sum + overlapArea(box, candidate), 0);
}

function scoreLabelCandidate(
  edge: RenderedEdge,
  candidate: LabelCandidate,
  position: Point,
  placedBoxes: LabelBox[],
  nodeBoxes: LabelBox[],
) {
  const box = getLabelBBox(edge.label, position);
  const nodeOverlapArea = totalOverlapArea(box, nodeBoxes);
  const labelOverlapArea = totalOverlapArea(box, placedBoxes);
  const nodeOverlapCount = nodeBoxes.filter((nodeBox) => isOverlapping(box, nodeBox)).length;
  const labelOverlapCount = placedBoxes.filter((placedBox) => isOverlapping(box, placedBox)).length;
  const viewShift = Math.hypot(position.x - candidate.position.x, position.y - candidate.position.y);

  return (
    nodeOverlapCount * 1_000_000 +
    nodeOverlapArea * 4_000 +
    labelOverlapCount * 100_000 +
    labelOverlapArea * 1_000 +
    viewShift * 500 +
    candidate.priority * 8 +
    candidateDistance(candidate) * 2
  );
}

function resolveLabelCollisions(edges: RenderedEdge[], layout: DiagramLayout) {
  const placedBoxes: LabelBox[] = [];
  const nodeBoxes = layout.nodes.map(getNodeBBox);

  return edges.map((edge) => {
    const candidates = edge.labelCandidates.length
      ? edge.labelCandidates
      : [{ edgePoint: edge.labelPosition, offset: LABEL_PATH_OFFSET, position: edge.labelPosition, priority: 0 }];
    const [bestCandidate] = candidates
      .map((candidate) => {
        const position = keepLabelInsideViewBox(edge, candidate.position, layout);
        return {
          candidate,
          position,
          score: scoreLabelCandidate(edge, candidate, position, placedBoxes, nodeBoxes),
        };
      })
      .sort((first, second) => first.score - second.score);
    const labelPosition = bestCandidate?.position ?? keepLabelInsideViewBox(edge, edge.labelPosition, layout);

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
    <g className="state-node-group" filter="url(#state-node-shadow)" key={node.id}>
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

function renderInitialStateArrow(node: DiagramNode, center: Point) {
  // Point the entry arrow inward from outside the diagram toward the node.
  const angle = Math.atan2(node.y - center.y, node.x - center.x) || -Math.PI / 2;
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const tip = {
    x: node.x + direction.x * (NODE_RADIUS + 6),
    y: node.y + direction.y * (NODE_RADIUS + 6),
  };
  const tail = {
    x: node.x + direction.x * (NODE_RADIUS + 34),
    y: node.y + direction.y * (NODE_RADIUS + 34),
  };
  const labelAnchor = {
    x: node.x + direction.x * (NODE_RADIUS + 48),
    y: node.y + direction.y * (NODE_RADIUS + 48),
  };
  return (
    <g>
      <path
        className="state-initial-arrow"
        d={`M ${pathPoint(tail)} L ${pathPoint(tip)}`}
        markerEnd="url(#state-diagram-initial-arrow)"
      />
      <text
        className="state-initial-label"
        dominantBaseline="middle"
        textAnchor="middle"
        x={numberValue(labelAnchor.x)}
        y={numberValue(labelAnchor.y)}
      >
        start
      </text>
    </g>
  );
}

export function renderStateDiagram(stateTable: StateTableRow[], machineType: ModelType, initialStateId?: string): ReactNode {
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
        <marker id="state-diagram-initial-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="8" refY="4" viewBox="0 0 8 8">
          <path className="state-initial-marker" d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
        <pattern height="20" id="state-diagram-grid" patternUnits="userSpaceOnUse" width="20">
          <rect fill="white" height="20" width="20" />
          <circle cx="10" cy="10" fill="rgba(100, 116, 139, 0.30)" r="0.9" />
        </pattern>
        <filter id="state-node-shadow" height="140%" width="140%" x="-20%" y="-20%">
          <feDropShadow dx="0" dy="1.5" floodColor="rgba(15, 23, 42, 0.25)" stdDeviation="2" />
        </filter>
      </defs>
      <rect fill="url(#state-diagram-grid)" height={layout.height} width={layout.width} x="0" y="0" />
      <g className="edges-layer state-edge-layer">
        {renderedEdges.map(renderEdge)}
        {initialStateId && nodeById.has(initialStateId)
          ? renderInitialStateArrow(nodeById.get(initialStateId) as DiagramNode, layout.center)
          : null}
      </g>
      <g className="labels-layer state-label-layer">
        {renderedEdges.map((edge) => renderEdgeLabel(edge.label, edge.labelPosition, `${edge.key}-label`))}
      </g>
      <g className="nodes-layer state-node-layer">{layout.nodes.map((node) => renderNode(node, machineType))}</g>
    </svg>
  );
}

// Styles inlined into exported SVG files so they render outside the app's stylesheet.
const EXPORT_STYLE = [
  ".state-node{fill:#ffffff;stroke:#dc2626;stroke-width:4px}",
  '.state-node-text{fill:#111827;font-family:"Times New Roman",Georgia,serif;font-size:22px;font-weight:700}',
  ".state-node-text-single{font-size:24px}",
  ".state-node-divider{stroke:#111827;stroke-linecap:round;stroke-width:2px}",
  ".state-edge{fill:none;stroke:#111827;stroke-linecap:round;stroke-width:2.25px}",
  ".state-edge-marker{fill:#111827}",
  ".state-initial-arrow{fill:none;stroke:#2563eb;stroke-linecap:round;stroke-width:2.5px}",
  ".state-initial-marker{fill:#2563eb}",
  '.state-initial-label{fill:#2563eb;font-family:"Times New Roman",Georgia,serif;font-size:13px;font-style:italic;font-weight:700}',
  ".state-edge-label-bg{fill:rgba(255,255,255,0.86);stroke:rgba(203,213,225,0.8);stroke-width:1px}",
  '.state-edge-label{fill:#111827;font-family:"Times New Roman",Georgia,serif;font-size:18px;font-weight:700}',
].join("");

export function StateDiagramPanel() {
  const modelType = useCircuitStore((state) => state.modelType);
  const stateTable = useCircuitStore((state) => state.stateTable);
  const flipFlopType = useCircuitStore((state) => state.flipFlopType);
  const initialStateBits = useCircuitStore((state) => state.initialStateBits);
  const scrollRef = useRef<HTMLDivElement>(null);

  function serializeDiagram() {
    const svg = scrollRef.current?.querySelector("svg");
    if (!svg) return null;
    return new XMLSerializer().serializeToString(svg).replace("<defs>", `<defs><style>${EXPORT_STYLE}</style>`);
  }

  function downloadSvg() {
    const markup = serializeDiagram();
    if (markup) exportSvgFile(markup, "state_diagram.svg");
  }

  async function downloadPng() {
    const markup = serializeDiagram();
    if (markup) await exportSvgAsPng(markup, "state_diagram.png");
  }

  return (
    <section className="panel state-diagram-panel" data-flip-flop-type={flipFlopType}>
      <h2>
        State Diagram ({modelType === "moore" ? "Moore" : "Mealy"})
        <span className="panel-hint">{modelType === "moore" ? "node: state / output" : "edge label: input / output"}</span>
        <span className="panel-header-actions">
          <button onClick={downloadPng} type="button">PNG</button>
          <button onClick={downloadSvg} type="button">SVG</button>
        </span>
      </h2>
      <div className="state-diagram-scroll" ref={scrollRef}>
        {renderStateDiagram(stateTable, modelType, initialStateBits)}
      </div>
    </section>
  );
}
