import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "apps/api/test/**/*.test.ts",
      "apps/worker/test/**/*.test.ts",
      "packages/action/test/**/*.test.ts",
      "packages/cli/test/**/*.test.ts",
      "packages/fdc-coston2/test/**/*.test.ts",
    ],
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/backend",
      include: [
        "apps/api/src/app.ts",
        "apps/api/src/postgres.ts",
        "apps/worker/src/**/*.ts",
        "packages/action/src/**/*.ts",
        "packages/cli/src/**/*.ts",
        "packages/fdc-coston2/src/**/*.ts",
      ],
      thresholds: {
        lines: 90,
        branches: 85,
      },
    },
  },
});
