# Sequential Circuit Studio

[![CI](https://github.com/jeremywu0420/codex/actions/workflows/ci.yml/badge.svg)](https://github.com/jeremywu0420/codex/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An EDA workbench for **sequential circuit design**. Enter a state table and get the complete design
flow — state diagram, excitation table, K-maps, minimized Boolean equations, a gate-level schematic,
timing simulation and synthesizable Verilog — with cross-verification at every step. A React frontend
talks to serverless API routes that run the design-flow engine; no accounts and no paid APIs.

**Deployment:** Cloudflare Pages + Functions. See [docs/cloudflare-deployment.md](docs/cloudflare-deployment.md)
for the setup; the app is served from your project's `https://<project-name>.pages.dev/` domain.

📄 **One-page tour:** [docs/PROJECT_OVERVIEW.pdf](docs/PROJECT_OVERVIEW.pdf) — overview, feature pipeline
and architecture with authentic generated diagrams.

![Workspace](docs/screenshots/workspace-light.png)

## Features

| Stage | What you get |
|---|---|
| **State table editor** | Click-to-cycle `0 → 1 → −` cells, Mealy/Moore models, D/T/JK/SR flip-flops, initial-state selection |
| **State diagram** | Deterministic symmetric layout, collision-free edge labels, labeled start arrow, PNG/SVG export |
| **Excitation table** | Derived from the flip-flop excitation rules, with a built-in rule reference card |
| **K-maps** | Gray-code headers, per-product-term group rings with legend (Quine–McCluskey minimization) |
| **Boolean expressions** | Minimized flip-flop input and output equations |
| **Circuit diagram** | Zone-placed, net-aware orthogonal schematic (inputs → gates → flip-flops → outputs). **Interactive:** hover a part or wire to trace its whole signal, click a part for an info card (pins + driving nets), a live `0/1/X` **Values** probe that propagates input/state values and steps the clock, plus fit-to-view, scroll-zoom and PNG/SVG export |
| **Timing diagram** | Cycle-accurate simulation from the reset state with a present-state annotation row and a step-by-step trace table |
| **Verilog** | Behavioral + gate-level modules and a self-checking testbench (honoring the configured reset/initial state), with syntax highlighting and one-click verification |
| **Validation** | Static design lint (unreachable states, trap states, don't-care coverage, Moore conflicts) plus equation/circuit/timing cross-checks, surfaced through a debounced, non-flickering status indicator |

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
npm run dev        # frontend only — http://localhost:5174/ (API clients fall back to local compute)
npm test           # vitest unit suite
npm run build      # type-check frontend + backend, then production build
npm run pages:dev  # full stack: serve dist/ + the /api/* Functions via wrangler
```

## Architecture

The app is split into a React frontend and serverless API routes. The heavy design-flow engine runs
on the backend; React components consume only API responses.

```
functions/api/            # Cloudflare Pages Functions (the backend)
├── workspace-compute.ts  #   equations · K-maps · circuit graph · verification · lint
├── circuit-layout.ts     #   orthogonal routing, trunk sharing, SVG generation
├── code-generation.ts    #   behavioral/gate-level Verilog + testbench
├── testbench-simulation.ts
└── timing-simulation.ts  #   interactive timing simulation data

src/
├── api/                  # typed fetch clients for the routes above (local fallback in dev)
├── logic/                # design-flow engine (framework-agnostic, heavily unit-tested)
│   ├── circuit/          #   modular circuit pipeline:
│   │   ├── constants · geometry · nets · pins   #   sizes, points, net ids, pin/anchor model
│   │   ├── routing · layout · validation        #   net-aware orthogonal routing + zone placement + checks
│   │   ├── junctions · render                   #   connection dots + SVG serialization
│   │   └── model · simulate                     #   view-model (signal/bus) + 0/1/X signal evaluation
│   ├── equations · minimizer · kmap             #   derivation + Quine–McCluskey minimization
│   ├── timing · interactiveSimulation · testbenchSimulation
│   └── circuitGraph · codeGenerator             #   gate graph + Verilog generation
├── lib/                  # verification, designLint, workspace (design-file + share-link encoding)
├── store/useCircuitStore.ts  # zustand store: undo/redo, autosave, share links, and a debounced
│                             #   idle/editing/validating/valid/invalid status machine
└── components/           # React + react-konva UI (one panel per tab, kept presentational)
```

Every edit keeps the last stable result on screen, then (debounced) recomputes the full pipeline in the
background; stale responses are discarded via a request id, so the result panels and validation badge
never flash. Generated artifacts (circuit layout, timing trace) are invalidated on edit and verified
against the table before Verilog export is unlocked. The circuit pipeline keeps layout/routing/validation
as pure functions; an SVG view-model + signal simulator layer on top power the interactive diagram.

## Tech stack

Frontend: React 18 · TypeScript · Vite · Zustand · react-konva (schematic canvas).
Backend: Cloudflare Pages Functions (Web-standard `Request`/`Response`). Tests: Vitest. No paid or
third-party runtime services.

## License

[MIT](LICENSE)
