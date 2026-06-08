import { useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Circle, Group, Layer, Line, Path, Rect, Stage, Text } from "react-konva";
import { circuitGraphToSvg, collectWireJunctionDots, expandBounds, getCircuitContentBounds, layoutCircuitGraph } from "../logic/circuitLayout";
import { useCircuitStore } from "../store/useCircuitStore";
import type { CircuitBounds, CircuitGraph, CircuitNode, Equation, FlipFlopType } from "../types";

const wire = "#64748b";
const ink = "#334155";

const ffPinsByType: Record<FlipFlopType, string[]> = {
  jk: ["J", "K"],
  d: ["D"],
  t: ["T"],
  sr: ["S", "R"],
};

function FormulaText({ x, y, label, size = 13 }: { x: number; y: number; label: string; size?: number }) {
  const [main, sub] = label.split("_");
  return (
    <Group>
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

function Junction({ x, y }: { x: number; y: number }) {
  return <Circle x={x} y={y} radius={3} fill="#000000" />;
}

function pointKey(point: { x: number; y: number }) {
  return `${Math.round(point.x)},${Math.round(point.y)}`;
}

function AndGate({ node }: { node: CircuitNode }) {
  return (
    <Group x={node.x} y={node.y}>
      <Path data="M0 0 L30 0 Q66 22 30 44 L0 44 Z" stroke={wire} strokeWidth={1.45} fill="white" />
    </Group>
  );
}

function OrGate({ node }: { node: CircuitNode }) {
  return (
    <Group x={node.x} y={node.y}>
      <Path data="M0 0 Q44 5 86 30 Q44 55 0 60 Q22 30 0 0 Z" stroke={wire} strokeWidth={1.45} fill="white" />
    </Group>
  );
}

function NotGate({ node }: { node: CircuitNode }) {
  return (
    <Group>
      <Line points={[node.x, node.y, node.x + 30, node.y + 15, node.x, node.y + 30, node.x, node.y]} stroke={wire} strokeWidth={1.35} closed fill="white" />
      <Circle x={node.x + 35} y={node.y + 15} radius={4} stroke={wire} strokeWidth={1.35} fill="white" />
    </Group>
  );
}

function FlipFlopBody({ node }: { node: CircuitNode }) {
  return (
    <Group>
      <Rect x={node.x} y={node.y} width={node.width ?? 126} height={node.height ?? 124} cornerRadius={2} fill="white" stroke={wire} strokeWidth={1.55} />
      <Line points={[node.x + 50, node.y + 124, node.x + 63, node.y + 112, node.x + 76, node.y + 124]} stroke={wire} strokeWidth={1.35} />
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
    <Group>
      {pins.map((pin) => (
        <FormulaText key={pin} x={node.x + 14} y={node.y + flipFlopPinOffset(pin) - 13} label={`${pin}_${state}`} size={16} />
      ))}
      <FormulaText x={node.x + 90} y={node.y + 34} label={`Q_${state}`} size={16} />
      <FormulaText x={node.x + 86} y={node.y + 82} label={`Q'_${state}`} size={16} />
      <Text text="CLK" x={node.x + 48} y={node.y + 130} fontSize={13} fill={ink} />
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
      <Text text={graph.clockLine.label} x={startX + 8} y={startY + 8} fontFamily="Times New Roman" fontSize={16} fontStyle="italic" fill={ink} />
      <Text text={graph.clockLine.label} x={endX + 8} y={endY - 10} fontFamily="Times New Roman" fontSize={16} fontStyle="italic" fill={ink} />
    </>
  );
}

function RenderCircuitDiagram({ graph, showRoutingBounds = false }: { graph: CircuitGraph; showRoutingBounds?: boolean }) {
  const gates = graph.nodes.filter((node) => node.type === "AND" || node.type === "OR" || node.type === "NOT");
  const flipFlops = graph.nodes.filter((node) => node.type === "FF");
  const junctionDots = collectWireJunctionDots(graph);

  return (
    <>
      {/* wires layer */}
      {graph.edges.map((edge) =>
        edge.points ? (
          <Line
            key={edge.id}
            id={edge.wireId}
            name="circuit-wire"
            points={edge.points}
            stroke={wire}
            strokeWidth={1.25}
            {...{ "data-wire-id": edge.wireId }}
          />
        ) : null,
      )}
      {graph.clockLine.points.length ? <Line points={graph.clockLine.points} stroke={wire} strokeWidth={1.45} /> : null}
      {graph.clockLine.branches.map((branch, index) => (
        <Group key={`clock-${index}-line`}>
          <Line points={branch} stroke={wire} strokeWidth={1.45} />
        </Group>
      ))}
      {/* gate body layer */}
      {gates.map((node) => (
        <GateBody key={node.id} node={node} />
      ))}
      {/* flip-flop body layer */}
      {flipFlops.map((node) => (
        <FlipFlopBody key={node.id} node={node} />
      ))}
      {showRoutingBounds ? <RoutingBounds bounds={graph.metadata.routingBounds ?? []} /> : null}
      {/* junction dots layer */}
      {graph.clockLine.branches.map((branch, index) => (
        <Junction key={`clock-${index}-dot`} x={branch[0]} y={branch[1]} />
      ))}
      {junctionDots.map((point) => (
        <Junction key={`junction-${pointKey(point)}`} x={point.x} y={point.y} />
      ))}
      {/* labels layer */}
      <ClockLabels graph={graph} />
      {graph.nodes.map((node) => (
        <NodeLabel key={node.id} node={node} />
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

type CircuitDiagramProps = {
  showRoutingBounds?: boolean;
};

export function CircuitDiagram({ showRoutingBounds = false }: CircuitDiagramProps = {}) {
  const { circuitGraph, equations, flipFlopType, variables } = useCircuitStore();
  const stageRef = useRef<Konva.Stage>(null);
  const [graph, setGraph] = useState<CircuitGraph | null>(null);
  const [generatedSignature, setGeneratedSignature] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const currentSignature = useMemo(
    () => JSON.stringify({ equations, flipFlopType, variables }),
    [equations, flipFlopType, variables],
  );
  const contentBounds = useMemo(() => (graph ? getCircuitContentBounds(graph) : null), [graph]);
  const isOutdated = Boolean(graph && generatedSignature !== currentSignature);
  const canUseDiagram = Boolean(graph);

  async function generateCircuit() {
    if (isLoading) return;
    setError("");
    if (!equations.length) {
      setError("No equations available. Generate equations before creating the circuit.");
      return;
    }
    if (!variables.states.length) {
      setError("No state variables available. Add at least one state variable.");
      return;
    }
    if (!flipFlopType) {
      setError("Select a flip-flop type before generating the circuit.");
      return;
    }

    setIsLoading(true);
    await Promise.resolve();
    const layoutedGraph = layoutCircuitGraph(circuitGraph);
    logCircuitGenerationDebug(layoutedGraph, equations, flipFlopType);
    if (layoutedGraph.metadata.validationErrors?.length) {
      setGraph(null);
      setError(`Circuit validation failed:\n${layoutedGraph.metadata.validationErrors.join("\n")}`);
      setIsLoading(false);
      return;
    }
    setGraph(layoutedGraph);
    setGeneratedSignature(currentSignature);
    setPosition({ x: 0, y: 0 });
    setZoom(1);
    setIsLoading(false);
  }

  function resetView() {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
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
    if (!graph) return;
    const svg = circuitGraphToSvg(graph, showRoutingBounds);
    const link = document.createElement("a");
    link.download = "logic-circuit.svg";
    link.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    link.click();
  }

  return (
    <section className="panel circuit-panel">
      <div className="diagram-tools">
        <button disabled={isLoading} onClick={generateCircuit} type="button">
          {isLoading ? "Generating..." : "Generate Circuit"}
        </button>
        <button disabled={!canUseDiagram} onClick={() => setZoom((value) => Math.min(value + 0.15, 2.4))} type="button">Zoom +</button>
        <button disabled={!canUseDiagram} onClick={() => setZoom((value) => Math.max(value - 0.15, 0.5))} type="button">Zoom -</button>
        <button disabled={!canUseDiagram} onClick={resetView} type="button">Reset View</button>
        <button disabled={!canUseDiagram} onClick={downloadPng} type="button">PNG</button>
        <button disabled={!canUseDiagram} onClick={downloadSvg} type="button">SVG</button>
      </div>

      {error ? <div className="diagram-alert error">{error}</div> : null}
      {isOutdated ? <div className="diagram-alert warning">Circuit is outdated. Click Generate Circuit again to update.</div> : null}

      <div className="stage-wrap" id="circuit-diagram">
        {!graph || !contentBounds ? (
          <div className="diagram-placeholder">Click Generate Circuit to create the circuit diagram from current equations.</div>
        ) : (
          <Stage
            draggable
            height={Math.ceil(contentBounds.height * zoom)}
            onDragEnd={(event) => setPosition(event.target.position())}
            ref={stageRef}
            scaleX={zoom}
            scaleY={zoom}
            width={Math.ceil(contentBounds.width * zoom)}
            x={position.x}
            y={position.y}
          >
            <Layer x={-contentBounds.x} y={-contentBounds.y}>
              <Rect x={contentBounds.x} y={contentBounds.y} width={contentBounds.width} height={contentBounds.height} fill="white" />
              <RenderCircuitDiagram graph={graph} showRoutingBounds={showRoutingBounds} />
            </Layer>
          </Stage>
        )}
      </div>
    </section>
  );
}
