import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
    // Safelight hands extensions its own React through api.react; a bundled
    // copy would break hooks.
    rollupOptions: { external: ["react", "react-dom"] },
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/gpu/**"],
    environment: "node",
  },
});
