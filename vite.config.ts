import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

declare const process: {
  env: Record<string, string | undefined>;
};

export default defineConfig({
  plugins: [react()],
  // Cloudflare Pages serves from the domain root; override with VITE_BASE_PATH
  // only when deploying to a subpath.
  base: process.env.VITE_BASE_PATH ?? "/",
  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: true,
  },
});
