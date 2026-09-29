import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** Node server shipped as dist/cli.js. Node builtins stay external. */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  build: {
    ssr: fileURLToPath(new URL("./src/cli/main.ts", import.meta.url)),
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      output: {
        banner: "#!/usr/bin/env node",
        entryFileNames: "cli.js",
        inlineDynamicImports: true,
      },
    },
  },
});
