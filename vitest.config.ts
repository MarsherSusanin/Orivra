import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    include: [
      "src/**/*.test.{ts,tsx}",
      "packages/**/test/**/*.test.ts",
      "apps/**/test/**/*.test.ts",
      "contracts/**/*.test.ts",
      "tests/**/*.contract.test.ts",
    ],
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}", "packages/*/src/**/*.ts"],
      exclude: ["src/main.tsx", "src/test/**", "**/*.d.ts"],
    },
  },
});
