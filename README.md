# Sequential Circuit Studio

[![CI](https://github.com/jeremywu0420/codex/actions/workflows/ci.yml/badge.svg)](https://github.com/jeremywu0420/codex/actions/workflows/ci.yml)
[![Deploy](https://github.com/jeremywu0420/codex/actions/workflows/deploy.yml/badge.svg)](https://github.com/jeremywu0420/codex/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A fully client-side EDA workbench for **sequential circuit design**. Enter a state table and get the
complete design flow — state diagram, excitation table, K-maps, minimized Boolean equations, a
gate-level schematic, timing simulation and synthesizable Verilog — with cross-verification at every
step. No server, no accounts, no paid APIs: everything runs in your browser.

**Live demo: <https://jeremywu0420.github.io/codex/>**

![Workspace](docs/screenshots/workspace-light.png)

## Features

| Stage | What you get |
|---|---|
| **State table editor** | Click-to-cycle `0 → 1 → −` cells, Mealy/Moore models, D/T/JK/SR flip-flops, initial-state selection |
| **State diagram** | Deterministic symmetric layout, collision-free edge labels, labeled start arrow, PNG/SVG export |
| **Excitation table** | Derived from the flip-flop excitation rules, with a built-in rule reference card |
| **K-maps** | Gray-code headers, per-product-term group rings with legend (Quine–McCluskey minimization) |
| **Boolean expressions** | Minimized flip-flop input and output equations |
| **Circuit diagram** | Auto-routed right-angle schematic with shared trunks, junction dots only at branches, blue clock network, PNG/SVG export |
| **Timing diagram** | Cycle-accurate simulation from any initial state with a present-state annotation row and trace table |
| **Verilog** | Behavioral + gate-level modules and a self-checking testbench, with syntax highlighting and one-click verification |
| **Validation** | Static design lint (unreachable states, trap states, don't-care coverage, Moore conflicts) plus equation/circuit/timing cross-checks |

### Workbench

- Light / dark theme
- Undo / redo, autosave to `localStorage`
- Built-in example designs (sequence detectors, counters, an intentionally broken table for the validator)
- **Design files**: export/import the whole design as JSON
- **Share links**: the entire design encoded in the URL hash — send a link, no server involved
- PDF report export

| | |
|---|---|
| ![State diagram](docs/screenshots/state-diagram.png) | ![Circuit](docs/screenshots/circuit-diagram.png) |
| ![K-maps](docs/screenshots/kmaps.png) | ![Timing](docs/screenshots/timing-diagram.png) |

![Dark mode](docs/screenshots/workspace-dark.png)

## Getting started

```bash
npm install
npm run dev        # http://localhost:5174/codex/
npm test           # vitest unit suite
npm run build      # type-check + production build
```

## Architecture

```
src/
├── logic/                 # Pure design-flow engine (no React)
│   ├── equations.ts       #   state table → next-state / excitation / output columns
│   ├── minimizer.ts       #   Quine–McCluskey boolean minimization
│   ├── kmap.ts            #   K-map models + per-term group coverage
│   ├── flipFlop.ts        #   D/T/JK/SR excitation rules
│   ├── circuitGraph.ts    #   equations → gate-level netlist
│   ├── circuitLayout.ts   #   orthogonal routing, trunk sharing, junction detection, SVG export
│   ├── timing.ts          #   cycle simulation + waveform SVG renderer
│   └── codeGenerator.ts   #   behavioral/gate-level Verilog + testbench
├── lib/
│   ├── verification.ts    # cross-checks equations, circuit and timing against the state table
│   ├── designLint.ts      # static input checks (reachability, traps, don't-cares, …)
│   └── workspace.ts       # design-file format, share-link encoding
├── store/useCircuitStore.ts  # zustand store: single source of truth, recomputes the whole flow on edit
└── components/            # React UI (tabs, panels, editors)
```

Every edit recomputes the full pipeline synchronously, so all tabs are always consistent with the
state table. Generated artifacts (circuit layout, timing trace) are invalidated on edit and verified
against the table before Verilog export is unlocked.

## Tech stack

React 18 · TypeScript · Vite · Zustand · react-konva (schematic canvas) · Vitest — and zero runtime
services.

## License

[MIT](LICENSE)
