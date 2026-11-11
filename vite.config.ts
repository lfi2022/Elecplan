import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
// Serve every PDF resource locally in development and in the self-hosted bundle.
for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  const target = path.resolve("web/public/pdfjs", folder);
  mkdirSync(target, { recursive: true });
  cpSync(path.resolve("node_modules/pdfjs-dist", folder), target, {
    recursive: true,
  });
}
export default defineConfig({
  plugins: [react(), tailwind()],
  root: "web",
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:3000" } },
});
