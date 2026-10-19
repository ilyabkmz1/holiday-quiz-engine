import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "tests/integration/**"],
    coverage: {
      reporter: ["text", "json", "html"],
      include: ["src/domain/**/*.ts", "src/config/**/*.ts", "src/server/**/*.ts"]
    }
  },
  resolve: {
    alias: {
      "@worlds": fileURLToPath(new URL("./worlds", import.meta.url)),
      "@profiles": fileURLToPath(new URL("./profiles", import.meta.url)),
      "@tenants": fileURLToPath(new URL("./tenants", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
