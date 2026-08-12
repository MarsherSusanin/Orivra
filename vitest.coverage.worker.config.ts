import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/worker/test/**/*.test.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/worker",
      include: ["apps/worker/src/**/*.ts"],
      exclude: [
        "apps/worker/src/entry.ts",
        "apps/worker/src/production-live-gate-entry.ts",
        "apps/worker/src/safe-consumer-deployer-entry.ts",
      ],
      thresholds: {
        lines: 90,
        branches: 85,
      },
    },
  },
});
