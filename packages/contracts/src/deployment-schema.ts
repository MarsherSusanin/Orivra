import { z } from "zod";
import { VersionV1Schema } from "./schema-primitives";

export const DeploymentHealthV1Schema = z
  .object({
    version: VersionV1Schema,
    status: z.literal("ok"),
  })
  .strict();

export type DeploymentHealthV1 = z.infer<typeof DeploymentHealthV1Schema>;

const DeploymentChecksV1Schema = z
  .object({
    database: z.enum(["unavailable", "ready"]),
    schema: z.enum(["unavailable", "mismatch", "ready"]),
    worker: z.enum(["unavailable", "missing", "stale", "ready"]),
  })
  .strict();

export const DeploymentReadinessV1Schema = z
  .object({
    version: VersionV1Schema,
    status: z.enum(["ready", "not-ready"]),
    checks: DeploymentChecksV1Schema,
  })
  .strict()
  .superRefine((readiness, context) => {
    const { database, schema, worker } = readiness.checks;
    const fullyReady = database === "ready" && schema === "ready" && worker === "ready";

    if (readiness.status === "ready") {
      if (!fullyReady) {
        context.addIssue({
          code: "custom",
          path: ["checks"],
          message: "Ready status requires every deployment check to be ready.",
        });
      }
      return;
    }

    if (fullyReady) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Fully ready checks require ready status.",
      });
    }
    if (database === "unavailable" && (schema !== "unavailable" || worker !== "unavailable")) {
      context.addIssue({
        code: "custom",
        path: ["checks"],
        message: "Database unavailability makes schema and worker unavailable.",
      });
    }
    if (database === "ready" && schema !== "ready" && worker !== "unavailable") {
      context.addIssue({
        code: "custom",
        path: ["checks", "worker"],
        message: "An unverified schema makes worker readiness unavailable.",
      });
    }
  });

export type DeploymentReadinessV1 = z.infer<
  typeof DeploymentReadinessV1Schema
>;
