/**
 * Generates docs/PROJECT_OVERVIEW.pdf — a README-style introduction to Sequential
 * Circuit Studio: overview, feature pipeline, architecture and authentic generated
 * diagrams (the real circuit + timing SVGs produced by the app's own renderers).
 *
 * Docs-only tool. Install the generator dependencies on demand, then run it:
 *   npm i -D tsx sharp
 *   npx tsx scripts/build-overview-pdf.mts
 * (jspdf is already a project dependency; tsx + sharp are not bundled with the app.)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import { jsPDF } from "jspdf";

import { examplePresets, exampleToStateTable } from "../src/examples";
import { buildCircuitGraph } from "../src/logic/circuitGraph";
import { layoutCircuitGraph, circuitGraphToSvg } from "../src/logic/circuitLayout";
import { deriveSequentialPipeline } from "../src/logic/equations";
import { generateTimingData, renderTimingDiagramSVG, buildDefaultInputSequence } from "../src/logic/timing";
import type { Bit, Variables } from "../src/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "docs");

// ---- palette -------------------------------------------------------------
const ink = [30, 41, 59] as const; // slate-800
const muted = [100, 116, 139] as const; // slate-500
const accent = [37, 99, 235] as const; // blue-600
const accentSoft = [239, 246, 255] as const;
const line = [219, 226, 234] as const;
const chipText = [55, 65, 81] as const;

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 18;
const CONTENT_W = PAGE_W - MARGIN * 2;

type RGB = readonly [number, number, number];

async function svgToPng(svg: string, scale = 2): Promise<{ dataUrl: string; width: number; height: number }> {
  const buffer = await sharp(Buffer.from(svg), { density: 96 * scale })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  const meta = await sharp(buffer).metadata();
  return { dataUrl: `data:image/png;base64,${buffer.toString("base64")}`, width: meta.width ?? 0, height: meta.height ?? 0 };
}

function buildSampleArtifacts() {
  const preset = examplePresets[0]; // 101 Sequence Detector (Mealy + D)
  const variables: Variables = { inputs: preset.inputs, states: ["A", "B"], outputs: preset.outputs, clock: "CLK" };
  const stateTable = exampleToStateTable(preset);
  const pipeline = deriveSequentialPipeline(stateTable, variables, preset.modelType, preset.flipFlopType);
  const graph = layoutCircuitGraph(buildCircuitGraph({ equations: pipeline.circuitEquations, flipFlopType: preset.flipFlopType, variables }));
  const circuitSvg = circuitGraphToSvg(graph);

  const initialState = Object.fromEntries(variables.states.map((s, i) => [s, (preset.initialStateBits[i] === "1" ? "1" : "0") as Bit])) as Record<string, Bit>;
  const timingData = generateTimingData(
    stateTable,
    preset.modelType,
    preset.flipFlopType,
    variables.states,
    variables.inputs,
    variables.outputs,
    buildDefaultInputSequence(variables.inputs, 8),
    initialState,
  );
  const timingSvg = renderTimingDiagramSVG(timingData);

  return { preset, variables, pipeline, circuitSvg, timingSvg };
}

async function main() {
  const { preset, variables, pipeline, circuitSvg, timingSvg } = buildSampleArtifacts();
  const circuitPng = await svgToPng(circuitSvg, 2);
  const timingPng = await svgToPng(timingSvg, 2);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = MARGIN;

  const setColor = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const setFill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);

  function ensureSpace(needed: number) {
    if (y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  }

  function heading(text: string) {
    ensureSpace(16);
    setFill(accent);
    doc.rect(MARGIN, y - 3.4, 2.6, 6.6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    setColor(ink);
    doc.text(text, MARGIN + 6, y + 2);
    y += 10;
  }

  function paragraph(text: string, size = 10.5, color: RGB = ink) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    setColor(color);
    const lines = doc.splitTextToSize(text, CONTENT_W);
    for (const ln of lines) {
      ensureSpace(size * 0.42 + 1.6);
      doc.text(ln, MARGIN, y);
      y += size * 0.42 + 1.6;
    }
    y += 2;
  }

  function bullet(title: string, body: string) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    const titleWidth = doc.getTextWidth(`${title}  `);
    const bodyLines = doc.splitTextToSize(body, CONTENT_W - 6 - titleWidth);
    ensureSpace(bodyLines.length * 4.6 + 2);
    setFill(accent);
    doc.circle(MARGIN + 1.4, y - 1.3, 0.9, "F");
    setColor(ink);
    doc.text(title, MARGIN + 5, y);
    doc.setFont("helvetica", "normal");
    setColor([71, 85, 105]);
    doc.text(bodyLines, MARGIN + 5 + titleWidth, y);
    y += Math.max(4.6, bodyLines.length * 4.6) + 1.2;
  }

  function chips(items: string[]) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    let x = MARGIN;
    const h = 6.4;
    ensureSpace(h + 4);
    for (const item of items) {
      const w = doc.getTextWidth(item) + 7;
      if (x + w > MARGIN + CONTENT_W) {
        x = MARGIN;
        y += h + 2.5;
        ensureSpace(h + 4);
      }
      setFill(accentSoft);
      doc.roundedRect(x, y - 4.4, w, h, 1.6, 1.6, "F");
      setColor(chipText);
      doc.text(item, x + 3.5, y);
      x += w + 2.5;
    }
    y += h + 2;
  }

  function image(png: { dataUrl: string; width: number; height: number }, caption: string, maxH = 90) {
    const ratio = png.height / png.width;
    let w = CONTENT_W;
    let h = w * ratio;
    if (h > maxH) {
      h = maxH;
      w = h / ratio;
    }
    ensureSpace(h + 9);
    const x = MARGIN + (CONTENT_W - w) / 2;
    setFill([255, 255, 255]);
    doc.setDrawColor(line[0], line[1], line[2]);
    doc.roundedRect(x - 2, y - 2, w + 4, h + 4, 1.6, 1.6, "FD");
    doc.addImage(png.dataUrl, "PNG", x, y, w, h, undefined, "FAST");
    y += h + 4;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    setColor(muted);
    doc.text(caption, MARGIN, y);
    y += 6;
  }

  function pageFooter() {
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i += 1) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      setColor(muted);
      doc.text("Sequential Circuit Studio", MARGIN, PAGE_H - 10);
      doc.text(`${i} / ${total}`, PAGE_W - MARGIN, PAGE_H - 10, { align: "right" });
      doc.setDrawColor(line[0], line[1], line[2]);
      doc.line(MARGIN, PAGE_H - 13, PAGE_W - MARGIN, PAGE_H - 13);
    }
  }

  // ---- cover ----
  setFill(accentSoft);
  doc.rect(0, 0, PAGE_W, 78, "F");
  setFill(accent);
  doc.rect(0, 78, PAGE_W, 1.4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  setColor(ink);
  doc.text("Sequential Circuit Studio", MARGIN, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12.5);
  setColor([51, 65, 85]);
  doc.text("A browser-based EDA workbench for finite-state machines", MARGIN, 45);
  doc.setFontSize(10.5);
  setColor(muted);
  doc.text(
    doc.splitTextToSize(
      "From a single state table, derive equations, K-maps, a state diagram, a routed gate-level circuit, an interactive timing simulation and synthesizable Verilog — all client-side, deployed on Cloudflare Pages.",
      CONTENT_W,
    ),
    MARGIN,
    54,
  );
  y = 92;

  heading("Overview");
  paragraph(
    "Sequential Circuit Studio turns a finite-state-machine specification into every classic digital-design artifact in real time. You edit one state table on the left; the app derives the next-state and excitation equations, minimizes them, draws the state diagram and a clean gate-level schematic, simulates the timing waveform, and emits behavioral, gate-level and testbench Verilog. Everything runs in the browser with a serverless (Cloudflare) compute fallback — no install, no backend database.",
  );

  heading("Feature pipeline");
  bullet("State table editor", "The single source of truth: present state + input -> next state + output, with Moore/Mealy and JK/D/T/SR flip-flop modes.");
  bullet("State diagram", "An auto-laid-out, curved-edge state graph with non-overlapping transition labels.");
  bullet("Excitation table & K-Maps", "Per-equation Karnaugh maps with gray-code headers and coloured rings marking each prime-implicant group.");
  bullet("Boolean equations", "Minimized next-state, excitation and output expressions derived from the table.");
  bullet("Circuit diagram", "A zone-placed, orthogonally-routed schematic (inputs -> gates -> flip-flops -> outputs) with hover signal-tracing, click-to-inspect parts and a live 0/1/X 'Values' probe.");
  bullet("Timing diagram", "A clock-driven waveform plus a step-by-step simulation table that checks the FSM against the reset state.");
  bullet("Verilog code", "Behavioral, gate-level and self-checking testbench Verilog, honoring the configured initial/reset state.");
  bullet("Validation", "Continuous design lint + verification with a debounced, non-flickering status indicator.");

  // ---- authentic visuals ----
  doc.addPage();
  y = MARGIN;
  heading("Generated circuit schematic");
  paragraph(
    `Authentic output for the built-in example "${preset.name}". The layout engine places components in left-to-right zones and routes every net on its own orthogonal lane so different signals never share a wire segment.`,
    10,
  );
  image(circuitPng, "Auto-generated gate-level schematic (the app's own SVG renderer).", 120);

  const eqText = pipeline.circuitEquations.map((e) => `${e.label} = ${e.expression}`).join("        ");
  paragraph(`Derived equations:  ${eqText}`, 9.5, [71, 85, 105]);

  heading("Timing simulation");
  paragraph("The clock-driven waveform for the same machine, with state annotations underneath each cycle.", 10);
  image(timingPng, "Interactive timing diagram (authentic SVG output).", 70);

  // ---- architecture ----
  doc.addPage();
  y = MARGIN;
  heading("Architecture");
  paragraph(
    "The app is a layered, mostly-pure TypeScript pipeline. UI components are thin; all derivation, layout, routing, simulation and code-generation logic lives in framework-agnostic modules under src/logic, making it testable in isolation (160+ unit tests) and reusable by the Cloudflare Functions backend.",
  );

  // data-flow strip
  const flow = ["State Table", "Equations", "Minimizer / K-Map", "Circuit Graph", "Layout + Routing", "SVG / Konva"];
  (function dataFlow() {
    const boxH = 12;
    const gap = 4;
    const boxW = (CONTENT_W - gap * (flow.length - 1)) / flow.length;
    ensureSpace(boxH + 10);
    doc.setFontSize(7.6);
    doc.setFont("helvetica", "bold");
    for (let i = 0; i < flow.length; i += 1) {
      const x = MARGIN + i * (boxW + gap);
      setFill(i % 2 === 0 ? accentSoft : [241, 245, 249]);
      doc.setDrawColor(line[0], line[1], line[2]);
      doc.roundedRect(x, y, boxW, boxH, 1.4, 1.4, "FD");
      setColor(ink);
      doc.text(doc.splitTextToSize(flow[i], boxW - 2), x + boxW / 2, y + boxH / 2 + 1, { align: "center" });
      if (i < flow.length - 1) {
        setColor(accent);
        doc.setFontSize(10);
        doc.text(">", x + boxW + gap / 2, y + boxH / 2 + 1.2, { align: "center" });
        doc.setFontSize(7.6);
      }
    }
    y += boxH + 9;
  })();

  heading("Module layout");
  bullet("src/logic/circuit/", "The circuit pipeline split into single-responsibility modules: constants, geometry, nets, pins, routing, validation, junctions, render, layout, model and simulate.");
  bullet("src/logic (core)", "equations, minimizer, kmap, timing, interactiveSimulation, testbenchSimulation, codeGenerator, circuitGraph.");
  bullet("src/store", "useCircuitStore (Zustand) — workspace state, undo/redo, autosave, share links and a debounced idle/editing/validating/valid/invalid status machine.");
  bullet("src/components", "React + react-konva views, one per tab, kept presentational.");
  bullet("src/api  +  functions/api", "A thin client API with a Cloudflare Functions backend and an in-browser dev fallback, so compute can run locally or serverless.");
  bullet("src/lib", "verification, design lint and workspace (de)serialization / share-link encoding.");

  heading("Tech stack");
  chips(["TypeScript", "React 18", "Vite", "Zustand", "Konva / react-konva", "Vitest", "Cloudflare Pages", "Cloudflare Functions", "jsPDF", "html2canvas"]);

  heading("Quality & engineering");
  bullet("Deterministic layout & routing", "Net-aware orthogonal routing guarantees different nets never share a segment; a canvas-bounds validator keeps everything on-page.");
  bullet("Tested", "160+ Vitest cases across logic, layout, routing, simulation, code-gen and the store; production build gated in CI.");
  bullet("Stable UX", "Debounced validation and a fixed-position status pill eliminate flicker while editing.");

  pageFooter();

  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "PROJECT_OVERVIEW.pdf");
  writeFileSync(outPath, Buffer.from(doc.output("arraybuffer")));
  console.log("Wrote", outPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
