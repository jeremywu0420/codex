# Cloudflare Pages + Functions Deployment

This project can be deployed as a private-source frontend plus serverless API on Cloudflare Pages.

## Repository Configuration

These files in the repository drive the Cloudflare deployment:

| File | Purpose |
|---|---|
| `wrangler.toml` | Pages project name, `compatibility_date`, and `pages_build_output_dir = "dist"`. Also enables `npm run pages:dev`. |
| `public/_routes.json` | Restricts the Functions runtime to `/api/*`; every static asset is served directly (faster, fewer Function invocations). Vite copies it to `dist/_routes.json`. |
| `tsconfig.functions.json` | Type-checks `functions/` (the backend). Wired into `npm run build` via `npm run typecheck:functions`, so a broken backend fails the build and CI. |

## Recommended Settings

Use a private GitHub repository, then connect that repository to Cloudflare Pages.

Cloudflare Pages settings:

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
Root directory: /
Environment variable: VITE_BASE_PATH=/
```

## Local Full-Stack Development

`npm run dev` serves only the frontend; the `src/api/*` clients fall back to local
computation when `import.meta.env.DEV` is true, so the app works without a backend.

To exercise the real `/api/*` Functions locally (same runtime as production):

```bash
npm run build
npm run pages:dev   # wrangler pages dev — serves dist/ + functions/
```

The frontend will be available at:

```text
https://<project-name>.pages.dev/
```

The serverless API routes in this repository will be available at:

```text
https://<project-name>.pages.dev/api/code-generation
https://<project-name>.pages.dev/api/circuit-layout
https://<project-name>.pages.dev/api/testbench-simulation
https://<project-name>.pages.dev/api/timing-simulation
https://<project-name>.pages.dev/api/workspace-compute
```

## What Is Hidden

Files under `functions/` run on Cloudflare's serverless runtime and are not served as browser JavaScript.

The Verilog Code page now calls backend routes for code-generation and simulation work:

```text
POST /api/code-generation
POST /api/circuit-layout
POST /api/testbench-simulation
POST /api/timing-simulation
POST /api/workspace-compute
```

This backend split moves the workspace-derived equations/K-maps/circuit graph/validation/lint, the circuit layout/SVG generation, the Code Generator artifacts, the Code Generator verification action, the Testbench Simulation entry point, and Timing Diagram simulation data behind API routes.

## What Is Still Frontend Code

The current app still contains UI rendering, design import/export, share-link serialization, and small display rules such as the visible excitation-rule table. Tests also still import local logic modules; test code is not part of the production browser bundle.

If you add more algorithm-heavy workflows later, keep the same pattern: put the implementation under `functions/api`, expose a small typed client under `src/api`, and let React components consume only API responses.

## Why `VITE_BASE_PATH=/`

The existing project keeps `/codex/` as the default Vite base path for GitHub Pages compatibility. Cloudflare Pages usually serves the app from the root of the generated domain, so set:

```text
VITE_BASE_PATH=/
```

If you later deploy to a subpath, set this value to that subpath instead.
