import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { Circle, Group, Layer, Line, Path, Rect, Stage, Text } from "react-konva";
import { layoutCircuitGraphApi } from "../api/circuitLayout";
import { evaluateNetValues, nextStateValues, toCircuitModel } from "../logic/circuit";
import type { SignalValue } from "../logic/circuit";
import { useCircuitStore } from "../store/useCircuitStore";
import type { CircuitBounds, CircuitEdge, CircuitGraph, CircuitNode, CircuitPoint, Equation, FlipFlopType } from "../types";

const wireBase = "#334155";
const wireHighlight = "#7c3aed";
const ink = "#1e293b";
const clockColor = "#2563eb";
const dimmedOpacity = 0.14;

const valueColors: Record<SignalValue, string> = {
  "1": "#16a34a",
  "0": "#64748b",
  X: "#d97706",
};
const gateStrokeWidth = 1.8;
const minZoom = 0.3;
const maxZoom = 2.6;
const bodyShadow = {
  shadowColor: "rgba(15, 23, 42, 0.22)",
  shadowBlur: 5,
  shadowOffsetX: 0,
  shadowOffsetY: 1.5,
};

function expandBounds(bounds: CircuitBounds, padding: number): CircuitBounds {
  return {
    ...bounds,
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
    padding,
  };
}

function makeGridPattern() {
  if (typeof document === "undefined") return null;
  const tile = document.createElement("canvas");
  tile.width = 20;
  tile.height = 20;
  const context = tile.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 20, 20);
  context.fillStyle = "rgba(100, 116, 139, 0.30)";
  context.beginPath();
  context.arc(10, 10, 0.9, 0, Math.PI * 2);
  context.fill();
  return tile;
}

const ffPinsByType: Record<FlipFlopType, string[]> = {
  jk: ["J", "K"],
  d: ["D"],
  t: ["T"],
  sr: ["S", "R"],
};

// Common 74-series part suggestions so the info card reads like a real schematic.
const flipFlopPartByType: Record<FlipFlopType, string> = {
  jk: "JK flip-flop (e.g. 7476)",
  d: "D flip-flop (e.g. 7474)",
  t: "T flip-flop",
  sr: "SR latch / flip-flop",
};

function setCursor(event: KonvaEventObject<unknown>, cursor: string) {
  const stage = event.target.getStage();
  if (stage) stage.container().style.cursor = cursor;
}

function FormulaText({ x, y, label, size = 13 }: { x: number; y: number; label: string; size?: number }) {
  const [main, sub] = label.split("_");
  return (
    <Group listening={false}>
      <Text text={main} x={x} y={y} fontFamily="Times New Roman" fontSize={size} fontStyle="bold italic" fill={ink} />
      {sub ? (
        <Text
          text={sub}
          x={x + size * 0.62}
          y={y + size * 0.55}
          fontFamily="Times New Roman"
          fontSize={size * 0.62}
          fontStyle="bold italic"
          fill={ink}
        />
      ) : null}
    </Group>
  );
}

function Junction({ x, y, color = wireBase }: { x: number; y: number; color?: string }) {
  return <Circle x={x} y={y} radius={3.2} fill={color} listening={false} />;
}

function pointKey(point: { x: number; y: number }) {
  return `${Math.round(point.x)},${Math.round(point.y)}`;
}

function AndGate({ node }: { node: CircuitNode }) {
  return (
    <Path
      data={`M${node.x} ${node.y} L${node.x + 44} ${node.y} A22 22 0 0 1 ${node.x + 44} ${node.y + 44} L${node.x} ${node.y + 44} Z`}
      stroke={wireBase}
      strokeWidth={gateStrokeWidth}
      fill="white"
      lineJoin="round"
      {...bodyShadow}
    />
  );
}

function OrGate({ node }: { node: CircuitNode }) {
  return (
    <Path
      data={`M${node.x} ${node.y} Q${node.x + 48} ${node.y + 2} ${node.x + 86} ${node.y + 30} Q${node.x + 48} ${node.y + 58} ${node.x} ${node.y + 60} Q${node.x + 19} ${node.y + 30} ${node.x} ${node.y} Z`}
      stroke={wireBase}
      strokeWidth={gateStrokeWidth}
      fill="white"
      lineJoin="round"
      {...bodyShadow}
    />
  );
}

function NotGate({ node }: { node: CircuitNode }) {
  return (
    <Group>
      <Line
        points={[node.x, node.y, node.x + 30, node.y + 15, node.x, node.y + 30, node.x, node.y]}
        stroke={wireBase}
        strokeWidth={1.6}
        closed
        fill="white"
        lineJoin="round"
        {...bodyShadow}
      />
      <Circle x={node.x + 35} y={node.y + 15} radius={5} stroke={wireBase} strokeWidth={1.6} fill="white" />
    </Group>
  );
}

function FlipFlopBody({ node }: { node: CircuitNode }) {
  return (
    <Group>
      <Rect
        x={node.x}
        y={node.y}
        width={node.width ?? 126}
        height={node.height ?? 124}
        cornerRadius={6}
        fill="white"
        stroke={wireBase}
        strokeWidth={gateStrokeWidth}
        {...bodyShadow}
      />
      <Line
        points={[node.x + 50, node.y + 124, node.x + 63, node.y + 112, node.x + 76, node.y + 124]}
        stroke={clockColor}
        strokeWidth={1.7}
        lineJoin="round"
        listening={false}
      />
    </Group>
  );
}

function flipFlopPinOffset(pin: string) {
  if (pin === "K" || pin === "R") return 86;
  if (pin === "D" || pin === "T") return 63;
  return 42;
}

function FlipFlopLabels({ node }: { node: CircuitNode }) {
  const type = node.flipFlopType ?? "jk";
  const pins = ffPinsByType[type];
  const state = String(node.metadata?.state ?? node.label);

  return (
    <Group listening={false}>
      {pins.map((pin) => (
        <FormulaText key={pin} x={node.x + 14} y={node.y + flipFlopPinOffset(pin) - 13} label={`${pin}_${state}`} size={16} />
      ))}
      <FormulaText x={node.x + 90} y={node.y + 34} label={`Q_${state}`} size={16} />
      <FormulaText x={node.x + 86} y={node.y + 82} label={`Q'_${state}`} size={16} />
      <Text text="CLK" x={node.x + 48} y={node.y + 130} fontSize={12} fontStyle="bold" fill={clockColor} />
    </Group>
  );
}

function GateBody({ node }: { node: CircuitNode }) {
  if (node.type === "AND") return <AndGate node={node} />;
  if (node.type === "OR") return <OrGate node={node} />;
  if (node.type === "NOT") return <NotGate node={node} />;
  return null;
}

function NodeLabel({ node }: { node: CircuitNode }) {
  if (node.type === "FF") return <FlipFlopLabels node={node} />;
  if (node.type === "AND" || node.type === "OR" || node.type === "NOT") return null;
  if (node.type === "STATE" || node.type === "STATE_NOT") return null;
  const labelX = typeof node.metadata?.labelX === "number" ? node.metadata.labelX : node.x + 8;
  const labelY = typeof node.metadata?.labelY === "number" ? node.metadata.labelY : node.y - 11;
  return <FormulaText x={labelX} y={labelY} label={node.label} size={13} />;
}

function RoutingBounds({ bounds }: { bounds: CircuitBounds[] }) {
  return (
    <>
      {bounds.map((bound) => {
        const expanded = expandBounds(bound, bound.padding ?? 0);
        return (
          <Rect
            key={bound.id}
            x={expanded.x}
            y={expanded.y}
            width={expanded.width}
            height={expanded.height}
            stroke="#38bdf8"
            dash={[5, 4]}
            opacity={0.38}
            listening={false}
          />
        );
      })}
    </>
  );
}

function ClockLabels({ graph }: { graph: CircuitGraph }) {
  if (!graph.clockLine.points.length) return null;
  const [startX, startY, endX, endY] = graph.clockLine.points;
  return (
    <>
      <Text text={graph.clockLine.label} x={startX + 8} y={startY + 8} fontFamily="Times New Roman" fontSize={16} fontStyle="bold italic" fill={clockColor} listening={false} />
      <Text text={graph.clockLine.label} x={endX + 8} y={endY - 10} fontFamily="Times New Roman" fontSize={16} fontStyle="bold italic" fill={clockColor} listening={false} />
    </>
  );
}

type Interaction = {
  activeNet: string | null;
  activeNode: string | null;
  hasFocus: boolean;
  onHoverNet: (netId: string | null) => void;
  onHoverNode: (nodeId: string | null) => void;
  onSelectNet: (netId: string | null) => void;
  onSelectNode: (nodeId: string | null) => void;
};

type ValueChip = { x: number; y: number; value: SignalValue };

function RenderCircuitDiagram({
  graph,
  junctionDots,
  interaction,
  styleForEdge,
  valueChips,
  showRoutingBounds = false,
}: {
  graph: CircuitGraph;
  junctionDots: CircuitPoint[];
  interaction: Interaction;
  styleForEdge: (edge: CircuitEdge) => { stroke: string; width: number };
  valueChips: ValueChip[];
  showRoutingBounds?: boolean;
}) {
  const gates = graph.nodes.filter((node) => node.type === "AND" || node.type === "OR" || node.type === "NOT");
  const flipFlops = graph.nodes.filter((node) => node.type === "FF");
  const { activeNet, activeNode, hasFocus } = interaction;

  const edgeIsActive = (edge: CircuitEdge) =>
    (activeNet != null && edge.netId === activeNet) || (activeNode != null && (edge.from === activeNode || edge.to === activeNode));

  // Nodes light up when selected/hovered directly or when they sit on an active signal path.
  const activeNodeIds = useMemo(() => {
    if (!hasFocus) return null;
    const ids = new Set<string>();
    if (activeNode) ids.add(activeNode);
    for (const edge of graph.edges) {
      if (edgeIsActive(edge)) {
        ids.add(edge.from);
        ids.add(edge.to);
      }
    }
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, activeNet, activeNode, hasFocus]);

  const nodeOpacity = (node: CircuitNode) => (activeNodeIds && !activeNodeIds.has(node.id) ? dimmedOpacity : 1);

  return (
    <>
      {/* wires layer */}
      {graph.edges.map((edge) => {
        if (!edge.points) return null;
        const active = edgeIsActive(edge);
        const dim = hasFocus && !active;
        const style = styleForEdge(edge);
        return (
          <Line
            key={edge.id}
            id={edge.wireId}
            name="circuit-wire"
            points={edge.points}
            stroke={active ? wireHighlight : style.stroke}
            strokeWidth={active ? 2.6 : style.width}
            opacity={dim ? dimmedOpacity : 1}
            hitStrokeWidth={12}
            lineJoin="round"
            lineCap="round"
            onMouseEnter={(event) => {
              setCursor(event, "pointer");
              interaction.onHoverNet(edge.netId ?? null);
            }}
            onMouseLeave={(event) => {
              setCursor(event, "default");
              interaction.onHoverNet(null);
            }}
            onClick={(event) => {
              event.cancelBubble = true;
              interaction.onSelectNet(edge.netId ?? null);
            }}
            {...{ "data-wire-id": edge.wireId }}
          />
        );
      })}
      {graph.clockLine.points.length ? (
        <Line points={graph.clockLine.points} stroke={clockColor} strokeWidth={1.7} opacity={hasFocus ? 0.3 : 1} lineJoin="round" lineCap="round" listening={false} />
      ) : null}
      {graph.clockLine.branches.map((branch, index) => (
        <Line key={`clock-${index}-line`} points={branch} stroke={clockColor} strokeWidth={1.7} opacity={hasFocus ? 0.3 : 1} lineJoin="round" lineCap="round" listening={false} />
      ))}
      {/* gate body layer */}
      {gates.map((node) => (
        <Group
          key={node.id}
          opacity={nodeOpacity(node)}
          onMouseEnter={(event) => {
            setCursor(event, "pointer");
            interaction.onHoverNode(node.id);
          }}
          onMouseLeave={(event) => {
            setCursor(event, "default");
            interaction.onHoverNode(null);
          }}
          onClick={(event) => {
            event.cancelBubble = true;
            interaction.onSelectNode(node.id);
          }}
        >
          <GateBody node={node} />
        </Group>
      ))}
      {/* flip-flop body layer */}
      {flipFlops.map((node) => (
        <Group
          key={node.id}
          opacity={nodeOpacity(node)}
          onMouseEnter={(event) => {
            setCursor(event, "pointer");
            interaction.onHoverNode(node.id);
          }}
          onMouseLeave={(event) => {
            setCursor(event, "default");
            interaction.onHoverNode(null);
          }}
          onClick={(event) => {
            event.cancelBubble = true;
            interaction.onSelectNode(node.id);
          }}
        >
          <FlipFlopBody node={node} />
        </Group>
      ))}
      {showRoutingBounds ? <RoutingBounds bounds={graph.metadata.routingBounds ?? []} /> : null}
      {/* junction dots layer */}
      {graph.clockLine.branches.map((branch, index) => (
        <Junction color={clockColor} key={`clock-${index}-dot`} x={branch[0]} y={branch[1]} />
      ))}
      {junctionDots.map((point) => (
        <Junction key={`junction-${pointKey(point)}`} x={point.x} y={point.y} />
      ))}
      {/* labels layer */}
      <ClockLabels graph={graph} />
      {graph.nodes.map((node) => (
        <Group key={node.id} opacity={nodeOpacity(node)}>
          <NodeLabel node={node} />
        </Group>
      ))}
      {/* signal value chips (Values mode) */}
      {valueChips.map((chip, index) => (
        <Group key={`value-${index}-${chip.x}-${chip.y}`} x={chip.x + 4} y={chip.y - 8} listening={false}>
          <Rect width={13} height={14} cornerRadius={3} fill={valueColors[chip.value]} opacity={0.92} />
          <Text text={chip.value} x={0} y={1} width={13} height={13} align="center" fontSize={11} fontStyle="bold" fill="#ffffff" />
        </Group>
      ))}
    </>
  );
}

function edgeDestination(edge: CircuitGraph["edges"][number]) {
  const targetState = edge.metadata?.targetState;
  const targetPin = edge.toPin ?? edge.metadata?.targetPin;
  const targetOutput = edge.metadata?.targetOutput;
  if (typeof targetState === "string" && typeof targetPin === "string") return `FF_${targetState}.${targetPin}`;
  if (typeof targetOutput === "string") return `OUTPUT_${targetOutput}`;
  if (edge.toPin) return `${edge.to}.${edge.toPin}`;
  if (typeof edge.metadata?.gateInputIndex === "number") return `${edge.to}.in${edge.metadata.gateInputIndex}`;
  return `${edge.to}${edge.toPin ? `.${edge.toPin}` : ""}`;
}

function debugRoutingLane(netId?: string) {
  if (!netId) return "";
  return [...netId].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 9;
}

function logCircuitGenerationDebug(graph: CircuitGraph, equations: Equation[], flipFlopType: FlipFlopType) {
  const targetEdges = graph.edges.filter((edge) => edge.metadata?.targetKind === "ff" || edge.metadata?.targetKind === "output");
  const targetByLabel = new Map(targetEdges.map((edge) => [String(edge.metadata?.equationLabel ?? edge.label ?? ""), edge]));
  const netRows = [...new Set(graph.edges.map((edge) => edge.netId).filter(Boolean))]
    .map((netId) => {
      const netEdges = graph.edges.filter((edge) => edge.netId === netId);
      return {
        netId,
        source: [...new Set(netEdges.map((edge) => edge.from))].join(", "),
        destinations: netEdges.map(edgeDestination).join(", "),
        fanOut: netEdges.length,
        routingLane: debugRoutingLane(netId),
      };
    });
  const expressionRows = graph.nodes
    .filter((node) => node.type === "AND" || node.type === "OR" || node.type === "NOT")
    .map((node) => {
      const outputNet = String(node.metadata?.outputNetId ?? "");
      return {
        canonicalExpressionKey: node.metadata?.canonicalExpressionKey ?? "",
        node: node.id,
        outputNet,
        routingLane: debugRoutingLane(outputNet),
        destinations: graph.edges.filter((edge) => edge.from === node.id && edge.netId === outputNet).map(edgeDestination).join(", "),
        fanoutCount: graph.edges.filter((edge) => edge.from === node.id && edge.netId === outputNet).length,
      };
    })
    .filter((row) => row.canonicalExpressionKey || row.fanoutCount > 1);

  console.groupCollapsed("Circuit generation debug");
  console.log("flip-flop type", flipFlopType);
  console.table(
    equations.map((equation) => {
      const targetEdge = targetByLabel.get(equation.label);
      return {
        label: equation.label,
        expression: equation.expression,
        canonicalExpressionKey: targetEdge?.metadata?.canonicalExpressionKey ?? "",
        outputNet: targetEdge?.netId ?? "",
      };
    }),
  );
  console.log("Expression registry");
  console.table(expressionRows);
  console.table(
    graph.nodes
      .filter((node) => node.type === "AND" || node.type === "OR" || node.type === "NOT")
      .map((node) => ({
        node: node.id,
        type: node.type,
        outputNet: node.metadata?.outputNetId ?? "",
        routingLane: debugRoutingLane(String(node.metadata?.outputNetId ?? "")),
        canonicalExpressionKey: node.metadata?.canonicalExpressionKey ?? "",
      })),
  );
  console.log("Net fan-out");
  console.table(netRows);
  console.log("validation result", graph.metadata.validationErrors?.length ? graph.metadata.validationErrors : "OK");
  console.groupEnd();
}

type ComponentInfo = {
  title: string;
  subtitle: string;
  inputs: { pin: string; signal: string }[];
  outputs: { pin: string; signal: string }[];
};

function describeNode(node: CircuitNode, graph: CircuitGraph): ComponentInfo {
  const incoming = graph.edges.filter((edge) => edge.to === node.id);
  const outgoing = graph.edges.filter((edge) => edge.from === node.id);
  const incomingPin = (edge: CircuitEdge) =>
    edge.toPin ?? (typeof edge.metadata?.gateInputIndex === "number" ? `in${edge.metadata.gateInputIndex}` : "in");

  if (node.type === "FF") {
    const type = node.flipFlopType ?? "jk";
    const state = String(node.metadata?.state ?? node.label);
    const pins = ffPinsByType[type];
    const inputs = pins.map((pin) => ({
      pin,
      signal: incoming.find((edge) => edge.toPin === pin)?.netId ?? "—",
    }));
    return {
      title: `${type.toUpperCase()} Flip-Flop ${state}`,
      subtitle: `${flipFlopPartByType[type]} · clocked by ${graph.clockLine.label || "CLK"}`,
      inputs: [...inputs, { pin: "CLK", signal: graph.clockLine.label || "CLK" }],
      outputs: [
        { pin: "Q", signal: outgoing.find((edge) => edge.fromPin === "Q")?.netId ?? state },
        { pin: "Q'", signal: outgoing.find((edge) => edge.fromPin === "Q'")?.netId ?? `${state}'` },
      ],
    };
  }
  if (node.type === "AND" || node.type === "OR" || node.type === "NOT") {
    const fn = node.type === "AND" ? "logical product" : node.type === "OR" ? "logical sum" : "inverter";
    return {
      title: `${node.type} gate`,
      subtitle: `Combinational · ${fn}`,
      inputs: incoming.map((edge) => ({ pin: incomingPin(edge), signal: edge.netId ?? "—" })),
      outputs: outgoing.map((edge) => ({ pin: edge.fromPin ?? "out", signal: edge.netId ?? String(node.metadata?.outputNetId ?? "—") })),
    };
  }
  const role = node.type === "INPUT" ? "Primary input" : node.type === "OUTPUT" ? "Primary output" : node.type === "STATE" ? "State feedback (Q)" : node.type === "STATE_NOT" ? "State feedback (Q')" : "Net";
  return {
    title: node.label,
    subtitle: role,
    inputs: incoming.map((edge) => ({ pin: incomingPin(edge), signal: edge.netId ?? "—" })),
    outputs: outgoing.map((edge) => ({ pin: edge.fromPin ?? "out", signal: edge.netId ?? "—" })),
  };
}

type CircuitDiagramProps = {
  showRoutingBounds?: boolean;
};

export function CircuitDiagram({ showRoutingBounds = false }: CircuitDiagramProps = {}) {
  const { circuitGraph, equations, flipFlopType, initialStateBits, setGeneratedCircuitGraph, variables } = useCircuitStore();
  const stageRef = useRef<Konva.Stage>(null);
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const [graph, setGraph] = useState<CircuitGraph | null>(null);
  const [contentBounds, setContentBounds] = useState<CircuitBounds | null>(null);
  const [junctionDots, setJunctionDots] = useState<CircuitPoint[]>([]);
  const [svgMarkup, setSvgMarkup] = useState("");
  const [generatedSignature, setGeneratedSignature] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [pendingFit, setPendingFit] = useState(false);

  // Interaction state for hover/click signal tracing and the component info card.
  const [hoveredNet, setHoveredNet] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNet, setSelectedNet] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Signal-probe state: live 0/1/X values driven by input + present-state toggles.
  const [showValues, setShowValues] = useState(false);
  const [inputValues, setInputValues] = useState<Record<string, SignalValue>>({});
  const [stateValues, setStateValues] = useState<Record<string, SignalValue>>({});

  const currentSignature = useMemo(
    () => JSON.stringify({ equations, flipFlopType, variables }),
    [equations, flipFlopType, variables],
  );
  const gridTile = useMemo(makeGridPattern, []);
  const isOutdated = Boolean(graph && generatedSignature !== currentSignature);
  const canUseDiagram = Boolean(graph && contentBounds);

  const clearSelection = useCallback(() => {
    setSelectedNet(null);
    setSelectedNode(null);
  }, []);

  const fitToView = useCallback(() => {
    const container = stageWrapRef.current;
    if (!container || !contentBounds) return;
    const availableWidth = container.clientWidth - 8;
    const availableHeight = container.clientHeight - 8;
    if (availableWidth <= 0 || availableHeight <= 0) return;
    const factor = Math.min(availableWidth / contentBounds.width, availableHeight / contentBounds.height);
    setZoom(Math.max(minZoom, Math.min(maxZoom, factor)));
    setPosition({ x: 0, y: 0 });
  }, [contentBounds]);

  // Fit once after a fresh generate, when the container has its real size.
  useLayoutEffect(() => {
    if (!pendingFit || !contentBounds) return;
    fitToView();
    setPendingFit(false);
  }, [pendingFit, contentBounds, fitToView]);

  const selectedNodeData = useMemo(
    () => (selectedNode && graph ? graph.nodes.find((node) => node.id === selectedNode) ?? null : null),
    [selectedNode, graph],
  );
  const selectedInfo = useMemo(
    () => (selectedNodeData && graph ? describeNode(selectedNodeData, graph) : null),
    [selectedNodeData, graph],
  );

  // Per-net colour/bus metadata from the view-model, used to colour wires by signal.
  const netMeta = useMemo(() => {
    const map = new Map<string, { color: string; isBus: boolean }>();
    if (!graph) return map;
    for (const wire of toCircuitModel(graph).wires) {
      if (!map.has(wire.netId)) map.set(wire.netId, { color: wire.color, isBus: wire.isBus });
    }
    return map;
  }, [graph]);

  // Live signal values for the current probe (only computed in Values mode).
  const netValues = useMemo(
    () => (graph && showValues ? evaluateNetValues(graph, inputValues, stateValues) : null),
    [graph, showValues, inputValues, stateValues],
  );

  const styleForEdge = useCallback(
    (edge: CircuitEdge) => {
      const netId = edge.netId ?? "";
      const meta = netMeta.get(netId);
      const value = netValues?.get(netId);
      if (value) return { stroke: valueColors[value], width: meta?.isBus ? 2.4 : 1.8 };
      return { stroke: meta?.color ?? wireBase, width: meta?.isBus ? 2 : 1.6 };
    },
    [netMeta, netValues],
  );

  const valueChips = useMemo<ValueChip[]>(() => {
    if (!graph || !netValues) return [];
    const seen = new Set<string>();
    const chips: ValueChip[] = [];
    for (const edge of graph.edges) {
      const netId = edge.netId ?? "";
      if (!netId || seen.has(netId)) continue;
      const value = netValues.get(netId);
      if (!value) continue;
      const anchor = edge.sourceAnchor ?? (edge.points && edge.points.length >= 2 ? { x: edge.points[0], y: edge.points[1] } : null);
      if (!anchor) continue;
      seen.add(netId);
      chips.push({ x: anchor.x, y: anchor.y, value });
    }
    return chips;
  }, [graph, netValues]);

  const resetProbes = useCallback(() => {
    const inputs: Record<string, SignalValue> = {};
    for (const name of variables.inputs) inputs[name] = "0";
    const states: Record<string, SignalValue> = {};
    variables.states.forEach((name, index) => {
      states[name] = initialStateBits?.[index] === "1" ? "1" : "0";
    });
    setInputValues(inputs);
    setStateValues(states);
  }, [variables, initialStateBits]);

  const stepClock = useCallback(() => {
    if (!graph) return;
    const values = evaluateNetValues(graph, inputValues, stateValues);
    setStateValues(nextStateValues(graph, values, stateValues));
  }, [graph, inputValues, stateValues]);

  const interaction: Interaction = {
    activeNet: selectedNet ?? hoveredNet,
    activeNode: selectedNode ?? hoveredNode,
    hasFocus: Boolean(selectedNet ?? hoveredNet ?? selectedNode ?? hoveredNode),
    onHoverNet: setHoveredNet,
    onHoverNode: setHoveredNode,
    onSelectNet: (netId) => {
      setSelectedNode(null);
      setSelectedNet(netId);
    },
    onSelectNode: (nodeId) => {
      setSelectedNet(null);
      setSelectedNode(nodeId);
    },
  };

  function resetDiagramState(message: string) {
    setGraph(null);
    setContentBounds(null);
    setJunctionDots([]);
    setSvgMarkup("");
    setGeneratedCircuitGraph(null);
    clearSelection();
    setError(message);
  }

  async function generateCircuit() {
    if (isLoading) return;
    setError("");
    if (!equations.length) {
      resetDiagramState("No equations available. Generate equations before creating the circuit.");
      return;
    }
    if (!variables.states.length) {
      resetDiagramState("No state variables available. Add at least one state variable.");
      return;
    }
    if (!flipFlopType) {
      resetDiagramState("Select a flip-flop type before generating the circuit.");
      return;
    }

    setIsLoading(true);
    await Promise.resolve();
    try {
      const result = await layoutCircuitGraphApi(circuitGraph, showRoutingBounds);
      const layoutedGraph = result.graph;
      logCircuitGenerationDebug(layoutedGraph, equations, flipFlopType);
      if (layoutedGraph.metadata.validationErrors?.length) {
        resetDiagramState(`Circuit validation failed:\n${layoutedGraph.metadata.validationErrors.join("\n")}`);
        setIsLoading(false);
        return;
      }
      setGraph(layoutedGraph);
      setContentBounds(result.contentBounds);
      setJunctionDots(result.junctionDots);
      setSvgMarkup(result.svg);
      setGeneratedCircuitGraph(layoutedGraph);
      setGeneratedSignature(currentSignature);
      clearSelection();
      setPendingFit(true);
    } catch (generationError) {
      resetDiagramState(generationError instanceof Error ? generationError.message : "Circuit generation failed.");
    } finally {
      setIsLoading(false);
    }
  }

  function resetView() {
    fitToView();
  }

  function handleWheel(event: KonvaEventObject<WheelEvent>) {
    event.evt.preventDefault();
    const factor = event.evt.deltaY < 0 ? 1.1 : 1 / 1.1;
    setZoom((value) => Math.max(minZoom, Math.min(maxZoom, value * factor)));
  }

  function downloadPng() {
    const uri = stageRef.current?.toDataURL({ pixelRatio: 2 });
    if (!uri) return;
    const link = document.createElement("a");
    link.download = "logic-circuit.png";
    link.href = uri;
    link.click();
  }

  function downloadSvg() {
    if (!svgMarkup) return;
    const link = document.createElement("a");
    link.download = "logic-circuit.svg";
    link.href = URL.createObjectURL(new Blob([svgMarkup], { type: "image/svg+xml" }));
    link.click();
  }

  useEffect(() => {
    clearSelection();
  }, [graph, clearSelection]);

  // Seed the probe with primary inputs at 0 and the configured initial state on each generate.
  useEffect(() => {
    if (graph) resetProbes();
  }, [graph, resetProbes]);

  return (
    <section className="panel circuit-panel">
      <div className="diagram-tools">
        <button disabled={isLoading} onClick={generateCircuit} type="button">
          {isLoading ? "Generating..." : "Generate Circuit"}
        </button>
        <button disabled={!canUseDiagram} onClick={() => setZoom((value) => Math.min(value + 0.15, maxZoom))} type="button">Zoom +</button>
        <button disabled={!canUseDiagram} onClick={() => setZoom((value) => Math.max(value - 0.15, minZoom))} type="button">Zoom -</button>
        <button disabled={!canUseDiagram} onClick={fitToView} type="button">Fit</button>
        <button disabled={!canUseDiagram} onClick={resetView} type="button">Reset View</button>
        <button
          aria-pressed={showValues}
          className={showValues ? "is-active" : ""}
          disabled={!canUseDiagram}
          onClick={() => setShowValues((value) => !value)}
          type="button"
        >
          {showValues ? "Values: On" : "Values"}
        </button>
        <button disabled={!canUseDiagram} onClick={downloadPng} type="button">PNG</button>
        <button disabled={!canUseDiagram} onClick={downloadSvg} type="button">SVG</button>
      </div>

      {canUseDiagram && showValues ? (
        <div className="diagram-probe">
          <span className="probe-label">Inputs</span>
          {variables.inputs.map((name) => (
            <button
              className={`probe-toggle value-${inputValues[name] ?? "0"}`}
              key={`in-${name}`}
              onClick={() => setInputValues((prev) => ({ ...prev, [name]: prev[name] === "1" ? "0" : "1" }))}
              type="button"
            >
              {name}=<b>{inputValues[name] ?? "0"}</b>
            </button>
          ))}
          <span className="probe-label">State</span>
          {variables.states.map((name) => (
            <button
              className={`probe-toggle value-${stateValues[name] ?? "0"}`}
              key={`st-${name}`}
              onClick={() => setStateValues((prev) => ({ ...prev, [name]: prev[name] === "1" ? "0" : "1" }))}
              type="button"
            >
              {name}=<b>{stateValues[name] ?? "0"}</b>
            </button>
          ))}
          <button className="probe-action" onClick={stepClock} type="button">Clock ▶</button>
          <button className="probe-action" onClick={resetProbes} type="button">Reset</button>
        </div>
      ) : null}

      {error ? <div className="diagram-alert error">{error}</div> : null}
      {isOutdated ? <div className="diagram-alert warning">Circuit is outdated. Click Generate Circuit again to update.</div> : null}
      {canUseDiagram ? <p className="diagram-hint">Hover a part or wire to trace its signal · click for details · scroll to zoom · drag to pan.</p> : null}

      <div className="stage-wrap" id="circuit-diagram" ref={stageWrapRef}>
        {!graph || !contentBounds ? (
          <div className="diagram-placeholder">Click Generate Circuit to create the circuit diagram from current equations.</div>
        ) : (
          <Stage
            draggable
            height={Math.ceil(contentBounds.height * zoom)}
            onDragEnd={(event) => setPosition(event.target.position())}
            onWheel={handleWheel}
            onClick={(event) => {
              // A click that reaches the stage background (not a wire/part) clears the selection.
              if (event.target === event.target.getStage()) clearSelection();
            }}
            ref={stageRef}
            scaleX={zoom}
            scaleY={zoom}
            width={Math.ceil(contentBounds.width * zoom)}
            x={position.x}
            y={position.y}
          >
            <Layer x={-contentBounds.x} y={-contentBounds.y}>
              {gridTile ? (
                <Rect
                  x={contentBounds.x}
                  y={contentBounds.y}
                  width={contentBounds.width}
                  height={contentBounds.height}
                  fillPatternImage={gridTile as unknown as HTMLImageElement}
                  fillPatternRepeat="repeat"
                />
              ) : (
                <Rect x={contentBounds.x} y={contentBounds.y} width={contentBounds.width} height={contentBounds.height} fill="white" />
              )}
              <RenderCircuitDiagram
                graph={graph}
                junctionDots={junctionDots}
                interaction={interaction}
                styleForEdge={styleForEdge}
                valueChips={valueChips}
                showRoutingBounds={showRoutingBounds}
              />
            </Layer>
          </Stage>
        )}

        {selectedInfo ? (
          <aside className="component-card" role="dialog" aria-label="Component details">
            <header className="component-card-head">
              <div>
                <p className="component-card-title">{selectedInfo.title}</p>
                <p className="component-card-subtitle">{selectedInfo.subtitle}</p>
              </div>
              <button aria-label="Close details" className="component-card-close" onClick={clearSelection} type="button">×</button>
            </header>
            <div className="component-card-pins">
              <div>
                <p className="component-card-section">Inputs</p>
                {selectedInfo.inputs.length ? (
                  <ul>
                    {selectedInfo.inputs.map((entry) => (
                      <li key={`in-${entry.pin}`}><span className="pin-name">{entry.pin}</span><span className="pin-signal">{entry.signal}</span></li>
                    ))}
                  </ul>
                ) : (
                  <p className="component-card-empty">None</p>
                )}
              </div>
              <div>
                <p className="component-card-section">Outputs</p>
                {selectedInfo.outputs.length ? (
                  <ul>
                    {selectedInfo.outputs.map((entry) => (
                      <li key={`out-${entry.pin}`}><span className="pin-name">{entry.pin}</span><span className="pin-signal">{entry.signal}</span></li>
                    ))}
                  </ul>
                ) : (
                  <p className="component-card-empty">None</p>
                )}
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
