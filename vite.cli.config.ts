import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";

/** Browser-folder build. `scripts/inline-html.mjs` collapses it to one HTML file. */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  publicDir: false,
  plugins: [tailwindcss(), viteReact()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: 100_000_000,
    rolldownOptions: {
      input: fileURLToPath(new URL("./cli.html", import.meta.url)),
      output: {
        codeSplitting: false,
      },
    },
  },
});
