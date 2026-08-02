import { createHash, randomBytes } from "node:crypto";
import type {
  DiagnosticV1,
  ProofBundleV1,
  RunEventV1,
  Web2JsonManifestV1,
} from "@proofline/contracts";
import {
  canonicalSerializeProofBundle,
  canonicalizeManifestUrl,
  createEvidenceReceipt,
  createProofBundle,
  diagnoseConsumerRequest,
  generateSafeWeb2JsonConsumer,
  projectRun,
  replayProofBundle,
} from "@proofline/domain";
import { createProoflineApi } from "./app";

interface StoredRun {
  runId: string;
  projectId: string;
  manifest: Web2JsonManifestV1;
  events: RunEventV1[];
  diagnostics: DiagnosticV1[];
  preflightEvidence?: {
    requestBytes: string;
    network: ProofBundleV1["network"];
  };
  artifactSource?: string;
}

interface QueuedCommand {
  id: string;
  runId: string;
  kind:
    | "RUN_PREFLIGHT"
    | "APPLY_REPLAY_EVIDENCE"
    | "ADVANCE_RELAYER"
    | "ADVANCE_WALLET"
    | "VERIFY_CONSUMER";
}

interface MemoryDatabase {
  runs: Map<string, StoredRun>;
  createKeys: Map<string, string>;
  commandKeys: Set<string>;
  submissionAuthorities: Map<
    string,
    {
      mode: "wallet" | "relayer" | "replay";
      idempotencyKey: string;
      commandId: string;
      transactionHash?: string;
    }
  >;
  queue: QueuedCommand[];
  shares: Map<string, string>;
}

const persistentDatabases = new Map<string, MemoryDatabase>();
let ephemeralSequence = 0;

function database(id?: string): MemoryDatabase {
  const key = id ?? `ephemeral-${++ephemeralSequence}`;
  let stored = persistentDatabases.get(key);
  if (!stored) {
    stored = {
      runs: new Map(),
      createKeys: new Map(),
      commandKeys: new Set(),
      submissionAuthorities: new Map(),
      queue: [],
      shares: new Map(),
    };
    persistentDatabases.set(key, stored);
  }
  return stored;
}

function commandId(prefix: string, key: string): string {
  return `${prefix}_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

function txHash(seed: string): `0x${string}` {
  return `0x${createHash("sha256").update(seed).digest("hex")}`;
}

export function createHermeticProoflineSystem(input: {
  projectToken: string;
  fixture: "web2json-host-invariant" | "web2json-wallet";
  now?: string;
  persistentDatabaseId?: string;
}) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Hermetic replay composition is only available in NODE_ENV=test");
  }
  const db = database(input.persistentDatabaseId);
  const occurredAt = input.now ?? "2025-05-15T12:04:11.000Z";
  const projectId = "project_hermetic";
  let broadcastCount = 0;

  function run(runId: string): StoredRun {
    const found = db.runs.get(runId);
    if (!found) throw Object.assign(new Error("Run not found"), { status: 404 });
    return found;
  }

  function append(
    stored: StoredRun,
    event: Omit<RunEventV1, "version" | "runId" | "sequence" | "occurredAt">,
  ): void {
    stored.events.push({
      version: "1",
      runId: stored.runId,
      sequence: stored.events.length + 1,
      occurredAt,
      ...event,
    } as RunEventV1);
    projectRun(stored.events);
  }

  function enqueue(command: QueuedCommand, key: string): void {
    if (db.commandKeys.has(key)) return;
    db.commandKeys.add(key);
    db.queue.push(command);
  }

  function appendPreflight(stored: StoredRun): void {
    stored.preflightEvidence ??= {
      requestBytes: "0x1234abcd",
      network: {
        chainId: 114,
        blockNumber: "12345678",
        registryAddress: "0x2222222222222222222222222222222222222222",
        resolvedContracts: {
          FdcHub: "0x3333333333333333333333333333333333333333",
          FdcRequestFeeConfigurations:
            "0x6666666666666666666666666666666666666666",
          FdcVerification: "0x1111111111111111111111111111111111111111",
          Relay: "0x4444444444444444444444444444444444444444",
        },
      },
    };
    append(stored, {
      commandId: "cmd_preflight",
      type: "PREFLIGHT_ACCEPTED",
      payload: {
        canonicalUrl: canonicalizeManifestUrl(stored.manifest),
        requestBytes: stored.preflightEvidence.requestBytes,
        quotedFeeWei: "12345",
      },
    });
  }

  function appendProofLifecycle(stored: StoredRun): void {
    append(stored, {
      commandId: "cmd_round",
      type: "ROUND_FINALIZED",
      payload: { votingRound: 42871 },
    });
    append(stored, {
      commandId: "cmd_proof",
      type: "PROOF_AVAILABLE",
      payload: { proofHash: txHash("hermetic-proof") },
    });
    append(stored, {
      commandId: "cmd_verify",
      type: "PROOF_VERIFIED",
      payload: {
        verificationContract: "0x1111111111111111111111111111111111111111",
      },
    });
  }

  async function processCommand(command: QueuedCommand): Promise<void> {
    const stored = run(command.runId);
    if (command.kind === "RUN_PREFLIGHT") {
      appendPreflight(stored);
      return;
    }
    if (command.kind === "APPLY_REPLAY_EVIDENCE") {
      append(stored, {
        commandId: "cmd_replay_submission",
        type: "REQUEST_SUBMITTED",
        payload: {
          mode: "relayer",
          transactionHash: txHash("hermetic-replay-submission"),
        },
      });
      appendProofLifecycle(stored);
      return;
    }
    if (command.kind === "ADVANCE_RELAYER") {
      broadcastCount += 1;
      append(stored, {
        commandId: command.id,
        type: "REQUEST_SUBMITTED",
        payload: {
          mode: "relayer",
          transactionHash: txHash(`hermetic-relayer:${command.id}`),
        },
      });
      appendProofLifecycle(stored);
      return;
    }
    if (command.kind === "ADVANCE_WALLET") {
      appendProofLifecycle(stored);
      return;
    }

    const requestUrl =
      input.fixture === "web2json-host-invariant"
        ? "https://mirror.example.net/prices/eth?currency=USD&source=primary"
        : canonicalizeManifestUrl(stored.manifest);
    stored.diagnostics = diagnoseConsumerRequest(stored.manifest, requestUrl);
    append(stored, {
      commandId: command.id,
      type: "CONSUMER_VERIFIED",
      payload: {
        passed: stored.diagnostics.length === 0,
        diagnostics: stored.diagnostics,
      },
    });
  }

  const service = {
    async createRun(context: {
      projectId: string;
      idempotencyKey: string;
      manifest: Web2JsonManifestV1;
    }) {
      const createKey = `${context.projectId}:${context.idempotencyKey}`;
      const existing = db.createKeys.get(createKey);
      if (existing) {
        return {
          status: "accepted",
          runId: existing,
          location: `/v1/runs/${existing}`,
        };
      }
      const runId = `run_${createHash("sha256")
        .update(createKey)
        .digest("hex")
        .slice(0, 24)}`;
      const stored: StoredRun = {
        runId,
        projectId: context.projectId,
        manifest: context.manifest,
        events: [],
        diagnostics: [],
      };
      append(stored, {
        commandId: commandId("cmd_create", context.idempotencyKey),
        type: "RUN_CREATED",
        payload: { manifest: context.manifest },
      });
      db.runs.set(runId, stored);
      db.createKeys.set(createKey, runId);
      enqueue(
        { id: "command_preflight", runId, kind: "RUN_PREFLIGHT" },
        `${runId}:preflight`,
      );
      return { status: "accepted", runId, location: `/v1/runs/${runId}` };
    },

    async getRun(context: { runId: string }) {
      const stored = run(context.runId);
      return { ...projectRun(stored.events), diagnostics: stored.diagnostics };
    },

    async listRuns(context: {
      projectId: string;
      status?: "active" | "completed" | "failed";
      cursor?: string;
      limit: number;
    }) {
      let offset = 0;
      if (context.cursor) {
        try {
          const parsed = JSON.parse(
            Buffer.from(context.cursor, "base64url").toString("utf8"),
          ) as Record<string, unknown>;
          if (!Number.isSafeInteger(parsed.offset) || Number(parsed.offset) < 0) {
            throw new Error("invalid offset");
          }
          offset = Number(parsed.offset);
        } catch {
          throw Object.assign(new Error("Run list cursor is invalid"), {
            status: 400,
            code: "INVALID_RUN_LIST_CURSOR",
          });
        }
      }
      const stageNames = [
        "preflight",
        "request",
        "round",
        "proof",
        "verify",
        "consumer",
      ] as const;
      const summaries = [...db.runs.values()]
        .filter((stored) => stored.projectId === context.projectId)
        .map((stored) => {
          const projection = projectRun(stored.events);
          const failed = stageNames.some((stage) => projection.stages[stage] === "failed");
          const status = failed ? "failed" as const : projection.terminal ? "completed" as const : "active" as const;
          const currentStage =
            stageNames.find((stage) => projection.stages[stage] === "active" || projection.stages[stage] === "failed") ??
            [...stageNames].reverse().find((stage) => projection.stages[stage] === "completed") ??
            "preflight";
          const updatedAt = stored.events.at(-1)?.occurredAt ?? occurredAt;
          return {
            version: "1" as const,
            runId: stored.runId,
            network: stored.manifest.network,
            sourceHost: new URL(stored.manifest.request.url).hostname.toLowerCase(),
            submissionMode: stored.manifest.submission.mode,
            currentStage,
            status,
            createdAt: stored.events[0].occurredAt,
            updatedAt,
            lastSequence: projection.sequence,
            resumable: !projection.terminal,
          };
        })
        .filter((summary) => !context.status || summary.status === context.status)
        .sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || right.runId.localeCompare(left.runId),
        );
      const runs = summaries.slice(offset, offset + context.limit);
      const nextOffset = offset + runs.length;
      return {
        version: "1" as const,
        runs,
        ...(nextOffset < summaries.length
          ? {
              nextCursor: Buffer.from(
                JSON.stringify({ offset: nextOffset }),
                "utf8",
              ).toString("base64url"),
            }
          : {}),
      };
    },

    async listEvents(context: { runId: string; after: number }) {
      const events = run(context.runId).events.filter(
        (event) => event.sequence > context.after,
      );
      return {
        events,
        nextAfter: events.at(-1)?.sequence ?? context.after,
      };
    },

    async createSubmission(context: {
      runId: string;
      mode: "wallet" | "relayer" | "replay";
      idempotencyKey: string;
    }) {
      const stored = run(context.runId);
      if (stored.manifest.submission.mode !== context.mode) {
        throw Object.assign(new Error("Submission mode does not match manifest"), {
          status: 409,
          code: "SUBMISSION_MODE_MISMATCH",
        });
      }
      const existingAuthority = db.submissionAuthorities.get(context.runId);
      if (
        existingAuthority &&
        context.mode !== "wallet" &&
        existingAuthority.mode === context.mode &&
        existingAuthority.idempotencyKey === context.idempotencyKey
      ) {
        return {
          version: "1" as const,
          runId: context.runId,
          mode: context.mode,
          effectOwner: context.mode === "relayer" ? "worker" as const : "none" as const,
          commandId: existingAuthority.commandId,
        };
      }
      const projection = projectRun(stored.events);
      if (projection.terminal) {
        throw Object.assign(new Error("Terminal runs are immutable"), {
          status: 409,
          code: "RUN_TERMINAL",
        });
      }
      if (!stored.events.some((event) => event.type === "PREFLIGHT_ACCEPTED")) {
        throw Object.assign(new Error("Preflight evidence is not ready"), {
          status: 409,
          code: "PREFLIGHT_NOT_READY",
        });
      }
      if (context.mode === "wallet") {
        if (projection.stages.request !== "pending" || existingAuthority) {
          throw Object.assign(
            new Error("Run already has one submission authority"),
            { status: 409, code: "SUBMISSION_INTENT_CONFLICT" },
          );
        }
        return {
          version: "1" as const,
          runId: context.runId,
          mode: "wallet",
          effectOwner: "wallet" as const,
          transaction: {
            chainId: "0x72",
            to: "0x3333333333333333333333333333333333333333",
            data: "0xfeedcafe",
            value: "0x3039",
          },
        };
      }
      if (existingAuthority) {
        throw Object.assign(new Error("Run already has one submission authority"), {
          status: 409,
          code: "SUBMISSION_INTENT_CONFLICT",
        });
      }
      const id = commandId(`command_${context.mode}`, context.idempotencyKey);
      db.submissionAuthorities.set(context.runId, {
        mode: context.mode,
        idempotencyKey: context.idempotencyKey,
        commandId: id,
      });
      if (context.mode === "replay") {
        enqueue(
          { id, runId: context.runId, kind: "APPLY_REPLAY_EVIDENCE" },
          `${context.runId}:submission:${context.idempotencyKey}`,
        );
        return {
          version: "1" as const,
          runId: context.runId,
          mode: "replay" as const,
          effectOwner: "none" as const,
          commandId: id,
        };
      }
      enqueue(
        { id, runId: context.runId, kind: "ADVANCE_RELAYER" },
        `${context.runId}:submission:${context.idempotencyKey}`,
      );
      return {
        version: "1" as const,
        runId: context.runId,
        mode: "relayer" as const,
        effectOwner: "worker" as const,
        commandId: id,
      };
    },

    async attachTransaction(context: {
      runId: string;
      idempotencyKey: string;
      transactionHash: string;
    }) {
      const stored = run(context.runId);
      if (stored.manifest.submission.mode !== "wallet") {
        throw Object.assign(new Error("Submission mode does not match manifest"), {
          status: 409,
          code: "SUBMISSION_MODE_MISMATCH",
        });
      }
      const dedupe = `${context.runId}:tx:${context.idempotencyKey}`;
      const existingAuthority = db.submissionAuthorities.get(context.runId);
      if (
        existingAuthority?.mode === "wallet" &&
        existingAuthority.idempotencyKey === context.idempotencyKey &&
        existingAuthority.transactionHash === context.transactionHash
      ) {
        return { accepted: true };
      }
      if (projectRun(stored.events).terminal) {
        throw Object.assign(new Error("Terminal runs are immutable"), {
          status: 409,
          code: "RUN_TERMINAL",
        });
      }
      if (!stored.events.some((event) => event.type === "PREFLIGHT_ACCEPTED")) {
        throw Object.assign(new Error("Preflight evidence is not ready"), {
          status: 409,
          code: "PREFLIGHT_NOT_READY",
        });
      }
      if (existingAuthority) {
        throw Object.assign(new Error("Run already has one submission authority"), {
          status: 409,
          code: "SUBMISSION_INTENT_CONFLICT",
        });
      }
      const attachmentCommandId = commandId("cmd_tx", context.idempotencyKey);
      db.submissionAuthorities.set(context.runId, {
        mode: "wallet",
        idempotencyKey: context.idempotencyKey,
        commandId: attachmentCommandId,
        transactionHash: context.transactionHash,
      });
      db.commandKeys.add(dedupe);
      append(stored, {
        commandId: attachmentCommandId,
        type: "REQUEST_SUBMITTED",
        payload: {
          mode: "wallet",
          transactionHash: context.transactionHash as `0x${string}`,
        },
      });
      enqueue(
        {
          id: "command_wallet_lifecycle",
          runId: context.runId,
          kind: "ADVANCE_WALLET",
        },
        `${context.runId}:wallet-lifecycle`,
      );
      return { accepted: true };
    },

    async verifyConsumer(context: {
      runId: string;
      idempotencyKey: string;
    }) {
      run(context.runId);
      enqueue(
        {
          id: commandId("cmd_consumer", context.idempotencyKey),
          runId: context.runId,
          kind: "VERIFY_CONSUMER",
        },
        `${context.runId}:consumer:${context.idempotencyKey}`,
      );
      return { accepted: true };
    },

    async generateConsumer(context: {
      runId: string;
      contractName?: string;
    }) {
      const stored = run(context.runId);
      stored.artifactSource = generateSafeWeb2JsonConsumer(stored.manifest, {
        contractName: context.contractName ?? "ProoflineSafeConsumer",
      });
      return {
        artifactId: `artifact_${stored.runId}`,
        source: stored.artifactSource,
        compilation: { success: true, compiler: "solc-0.8.36" },
      };
    },

    async getBundle(context: { runId: string }) {
      const stored = run(context.runId);
      const preflightEvidence = stored.preflightEvidence;
      if (!preflightEvidence) {
        throw Object.assign(new Error("Persisted preflight evidence is not ready"), {
          status: 409,
          code: "PREFLIGHT_NOT_READY",
        });
      }
      const source =
        stored.artifactSource ??
        generateSafeWeb2JsonConsumer(stored.manifest, {
          contractName: "ProoflineSafeConsumer",
        });
      const bundle = createProofBundle({
        version: "1",
        runId: stored.runId,
        manifest: stored.manifest,
        events: stored.events,
        requestBytes: preflightEvidence.requestBytes,
        network: preflightEvidence.network,
        proof: {
          votingRound: 42871,
          merkleProof: [txHash("hermetic-merkle")],
          response: "0x1234",
        },
        verification: {
          proofVerified: true,
          consumerVerified: stored.diagnostics.length === 0,
          diagnostics: stored.diagnostics,
        },
        artifacts: {
          safeConsumerSha256: createHash("sha256").update(source).digest("hex"),
        },
      });
      return canonicalSerializeProofBundle(bundle);
    },

    async getEvidenceReceipt(context: { runId: string }) {
      const serialized = await service.getBundle(context);
      return createEvidenceReceipt(serialized);
    },

    async replay(context: { bundle: string }) {
      replayProofBundle(context.bundle);
      return {
        runId: "run_replay",
        byteIdentical: true,
        canonicalBundle: context.bundle,
      };
    },

    async createShare(context: { runId: string }) {
      run(context.runId);
      const token = `share_${randomBytes(32).toString("hex")}`;
      db.shares.set(token, context.runId);
      return { token, url: `https://proofline.test/shared/${token}` };
    },
  };

  const api = createProoflineApi({
    service,
    authenticate: async (token) => {
      if (token === input.projectToken) return { kind: "project", projectId };
      const runId = db.shares.get(token);
      return runId ? { kind: "share", projectId, runId } : null;
    },
  });

  return {
    api,
    worker: {
      async drain() {
        let processed = 0;
        while (db.queue.length > 0) {
          const next = db.queue.shift()!;
          await processCommand(next);
          processed += 1;
        }
        return { processed, idle: true };
      },
    },
    repository: {
      events(runId: string) {
        return [...run(runId).events];
      },
    },
    adapters: {
      get broadcastCount() {
        return broadcastCount;
      },
    },
  };
}
