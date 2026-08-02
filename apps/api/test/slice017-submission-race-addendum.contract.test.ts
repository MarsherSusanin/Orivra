// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { validManifest } from "../../../packages/contracts/test/fixtures";
import { createProductionProoflineService } from "../src/production-service";

const PROJECT_ID = "11111111-1111-4111-8111-111111111117";
const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa217";

const relayerManifest = {
  ...validManifest,
  submission: { ...validManifest.submission, mode: "relayer" as const },
};
const projection = {
  terminal: false,
  stages: { preflight: "completed" },
};

function result(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount };
}

function service(query: ReturnType<typeof vi.fn>) {
  return createProductionProoflineService({
    pool: { query } as any,
    tokenDigestKey: "slice-017-race-key",
    publicWebOrigin: "https://proofline.test",
  });
}

function context() {
  return {
    runId: RUN_ID,
    projectId: PROJECT_ID,
    mode: "relayer" as const,
    idempotencyKey: "raced-submission",
  };
}

function runRow() {
  return {
    id: RUN_ID,
    project_id: PROJECT_ID,
    manifest: relayerManifest,
    projection,
    last_sequence: 2,
  };
}

function conflictingCommand(idempotencyKey = "other-key") {
  return {
    id: "command_competing",
    project_id: PROJECT_ID,
    run_id: RUN_ID,
    idempotency_key: idempotencyKey,
    kind: "SUBMIT_RELAYER",
    payload: { idempotencyKey },
    status: "queued",
  };
}

describe("Slice 017 submission race normalization", () => {
  it("normalizes an ON CONFLICT intent race", async () => {
    let keyLookup = 0;
    const query = vi.fn(async (text: string) => {
      if (/SELECT id, project_id, manifest, projection, last_sequence/i.test(text)) {
        return result([runRow()]);
      }
      if (/WHERE project_id = \$1 AND idempotency_key = \$2/i.test(text)) {
        keyLookup += 1;
        return keyLookup < 3
          ? result([], 0)
          : result([{
              ...conflictingCommand("raced-submission"),
              run_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb217",
            }]);
      }
      if (/kind IN \(/i.test(text)) return result([], 0);
      if (/INSERT INTO proofline_private\.run_commands/i.test(text)) {
        return result([], 0);
      }
      return result([], 0);
    });

    await expect(service(query).createSubmission(context())).rejects.toMatchObject({
      status: 409,
      code: "SUBMISSION_INTENT_CONFLICT",
    });
  });

  it("normalizes a unique run-authority race", async () => {
    let authorityLookup = 0;
    const query = vi.fn(async (text: string) => {
      if (/SELECT id, project_id, manifest, projection, last_sequence/i.test(text)) {
        return result([runRow()]);
      }
      if (/WHERE project_id = \$1 AND idempotency_key = \$2/i.test(text)) {
        return result([], 0);
      }
      if (/kind IN \(/i.test(text)) {
        authorityLookup += 1;
        return authorityLookup === 1
          ? result([], 0)
          : result([conflictingCommand()]);
      }
      if (/INSERT INTO proofline_private\.run_commands/i.test(text)) {
        throw Object.assign(new Error("one active submission authority"), {
          code: "23505",
          constraint: "run_commands_one_submission_authority",
        });
      }
      return result([], 0);
    });

    await expect(service(query).createSubmission(context())).rejects.toMatchObject({
      status: 409,
      code: "SUBMISSION_INTENT_CONFLICT",
    });
  });
});
