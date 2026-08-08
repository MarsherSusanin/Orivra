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
        "apps/api/src/wallet-auth.ts",
        "apps/api/src/wallet-session-service.ts",
        "apps/api/src/account-token-service.ts",
        "apps/api/src/postgres.ts",
        "apps/api/src/production-service.ts",
        "apps/api/src/bootstrap.ts",
        "apps/worker/src/**/*.ts",
        "apps/worker/src/bootstrap.ts",
        "packages/action/src/**/*.ts",
        "packages/cli/src/**/*.ts",
        "packages/fdc-coston2/src/**/*.ts",
      ],
      exclude: [
        "apps/api/src/server.ts",
        "apps/worker/src/entry.ts",
        "packages/action/src/entry.ts",
        "packages/cli/src/bin.ts",
      ],
      thresholds: {
        lines: 90,
        branches: 85,
      },
    },
  },
});
