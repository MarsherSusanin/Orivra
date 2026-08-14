import { createHash, randomUUID as nodeRandomUUID } from "node:crypto";
import {
  ConsumerLabReportV1Schema,
  CreateRunResultV1Schema,
  EvidenceReceiptV1Schema,
  PreflightReportV1Schema,
  ProofBundleV1Schema,
  RunEventV1Schema,
  RunListPageV1Schema,
  RunProjectionV1Schema,
  SubmissionResponseV1Schema,
  Web2JsonManifestV1Schema,
  Web2JsonTemplateCatalogV1Schema,
  Web2JsonTemplateDetailV1Schema,
  type Web2JsonManifestV1,
} from "@proofline/contracts";
import { canonicalJson } from "@proofline/domain";
import { z } from "zod";
import {
  createOrivraApiClient,
  LARGE_RESOURCE_MAX_BYTES,
  OrivraMcpError,
  type McpErrorType,
} from "./api-client";
import type { OrivraMcpConfiguration } from "./config";

const RunIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const OperationIdSchema = z.string().min(1).max(180).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const AcceptedCommandSchema = z.object({
  accepted: z.literal(true),
  runId: RunIdSchema,
  commandId: z.string().min(1).max(256),
}).strict();
const GeneratedConsumerSchema = z.object({ source: z.string().min(1).max(1_000_000) }).strict();
const ReplayResultSchema = z.object({
  runId: RunIdSchema,
  byteIdentical: z.literal(true),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
}).strict();
const EventsPageSchema = z.object({
  events: z.array(RunEventV1Schema).max(10_000),
  nextAfter: z.number().int().nonnegative(),
}).strict();

export type OrivraResourceLink = Readonly<{
  uri: string;
  name: string;
  mimeType: "application/json" | "text/x-solidity";
}>;

export type CompactToolResult = Readonly<{
  status: "success" | "pending" | "error";
  summary: string;
  operationId?: string;
  runId?: string;
  checksum?: string;
  stage?: string;
  resources?: readonly OrivraResourceLink[];
  nextActions: readonly string[];
  errorType?: McpErrorType;
}>;

export type ReplaySource =
  | { kind: "template"; templateId: string; revision: number }
  | { kind: "manifest"; manifest: Web2JsonManifestV1 };

function operationId(value: string | undefined, generate: () => string): string {
  return OperationIdSchema.parse(value ?? `mcp_${generate()}`);
}

function encodeId(value: string): string {
  return encodeURIComponent(RunIdSchema.parse(value));
}

function link(uri: string, name: string, mimeType: OrivraResourceLink["mimeType"] = "application/json"): OrivraResourceLink {
  return Object.freeze({ uri, name, mimeType });
}

function sha256Envelope(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function createOrivraMcpRuntime(input: {
  configuration: OrivraMcpConfiguration;
  fetch?: typeof globalThis.fetch;
  randomUUID?: () => string;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  replayReadyTimeoutMs?: number;
}) {
  const api = createOrivraApiClient({
    configuration: input.configuration,
    fetch: input.fetch ?? globalThis.fetch.bind(globalThis),
  });
  const generateUuid = input.randomUUID ?? nodeRandomUUID;
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? api.sleep;
  const replayReadyTimeoutMs = input.replayReadyTimeoutMs ?? 60_000;
  const generatedConsumers = new Map<string, string>();

  async function templateDetail(templateId: string, revision: number) {
    const id = z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).parse(templateId);
    const expectedRevision = z.number().int().positive().safe().parse(revision);
    const response = await api.requestValidated(
      `/templates/${encodeURIComponent(id)}`,
      Web2JsonTemplateDetailV1Schema,
    );
    const detail = response.value;
    if (detail.template.revision !== expectedRevision) {
      throw new OrivraMcpError("not_found", "The requested template revision is not available");
    }
    const canonical = canonicalJson(detail.manifest);
    if (
      canonical !== detail.manifestCanonicalJson ||
      sha256Envelope(canonical) !== detail.provenance.manifestSha256
    ) {
      throw new OrivraMcpError("upstream_error", "Template provenance did not match the canonical manifest");
    }
    return detail;
  }

  async function listTemplates(): Promise<CompactToolResult & { templates: unknown[] }> {
    const { value } = await api.requestValidated("/templates", Web2JsonTemplateCatalogV1Schema);
    return {
      status: "success",
      summary: `Found ${value.templates.length} Orivra templates.`,
      templates: value.templates,
      resources: value.templates.map((item) => link(
        `orivra://templates/${item.id}/${item.revision}/manifest`,
        `${item.title} manifest`,
      )),
      nextActions: ["get_template", "create_replay_run"],
    };
  }

  async function getTemplate(request: { templateId: string; revision: number }): Promise<CompactToolResult & { template: unknown }> {
    const detail = await templateDetail(request.templateId, request.revision);
    return {
      status: "success",
      summary: `Loaded ${detail.template.title} revision ${detail.template.revision}.`,
      template: detail.template,
      checksum: detail.template.manifestSha256,
      resources: [link(
        `orivra://templates/${detail.template.id}/${detail.template.revision}/manifest`,
        `${detail.template.title} manifest`,
      )],
      nextActions: ["create_replay_run"],
    };
  }

  async function listRuns(request: {
    status?: "active" | "completed" | "failed";
    cursor?: string;
    limit?: number;
  } = {}): Promise<CompactToolResult & { runs: unknown[]; nextCursor?: string }> {
    const query = new URLSearchParams();
    if (request.status) query.set("status", request.status);
    if (request.cursor) query.set("cursor", request.cursor);
    if (request.limit !== undefined) query.set("limit", String(request.limit));
    const { value } = await api.requestValidated(
      `/runs${query.size > 0 ? `?${query.toString()}` : ""}`,
      RunListPageV1Schema,
    );
    return {
      status: "success",
      summary: `Found ${value.runs.length} project runs.`,
      runs: value.runs,
      ...(value.nextCursor ? { nextCursor: value.nextCursor } : {}),
      resources: value.runs.map((run) => link(`orivra://runs/${run.runId}`, `Run ${run.runId}`)),
      nextActions: value.runs.length > 0 ? ["inspect_run"] : ["list_templates", "create_replay_run"],
    };
  }

  async function inspectRun(request: { runId: string }): Promise<CompactToolResult & { projection: unknown }> {
    const runId = RunIdSchema.parse(request.runId);
    const { value } = await api.requestValidated(`/runs/${encodeId(runId)}`, RunProjectionV1Schema);
    if (value.runId !== runId) throw new OrivraMcpError("upstream_error", "Run identity did not match the request");
    const resources = [
      link(`orivra://runs/${runId}`, `Run ${runId}`),
      link(`orivra://runs/${runId}/events`, `Run ${runId} events`),
    ];
    if (value.stages.preflight === "completed") {
      resources.push(link(`orivra://runs/${runId}/preflight`, `Run ${runId} preflight`));
    }
    if (value.stages.consumer === "completed" || value.stages.consumer === "failed") {
      resources.push(link(`orivra://runs/${runId}/consumer-lab`, `Run ${runId} Consumer Lab`));
    }
    if (value.terminal) {
      resources.push(
        link(`orivra://runs/${runId}/receipt`, `Run ${runId} receipt`),
        link(`orivra://runs/${runId}/bundle`, `Run ${runId} bundle`),
      );
    }
    const active = Object.entries(value.stages).find(([, state]) => state === "active")?.[0]
      ?? Object.entries(value.stages).find(([, state]) => state === "pending")?.[0]
      ?? "completed";
    return {
      status: value.terminal ? "success" : "pending",
      summary: value.terminal ? "Run is terminal and its persisted evidence is available." : `Run is currently at ${active}.`,
      runId,
      stage: active,
      projection: value,
      resources,
      nextActions: value.terminal
        ? ["validate_run_bundle", "verify_consumer", "generate_safe_consumer"]
        : ["inspect_run"],
    };
  }

  async function createReplayRun(request: {
    source: ReplaySource;
    operationId?: string;
  }): Promise<CompactToolResult> {
    const id = operationId(request.operationId, generateUuid);
    const manifestInput = request.source.kind === "template"
      ? (await templateDetail(request.source.templateId, request.source.revision)).manifest
      : request.source.manifest;
    const parsedManifest = Web2JsonManifestV1Schema.parse(manifestInput);
    const manifest = Web2JsonManifestV1Schema.parse({
      ...parsedManifest,
      submission: { ...parsedManifest.submission, mode: "replay" },
    });
    const { value: created } = await api.requestValidated("/runs", CreateRunResultV1Schema, {
      method: "POST",
      body: { manifest },
      idempotencyKey: `${id}:create`,
    });
    const startedAt = now();
    while (true) {
      try {
        const { value: submission } = await api.requestValidated(
          `/runs/${encodeId(created.runId)}/submissions`,
          SubmissionResponseV1Schema,
          {
            method: "POST",
            body: { mode: "replay" },
            idempotencyKey: `${id}:submit`,
          },
        );
        if (
          submission.runId !== created.runId ||
          submission.mode !== "replay" ||
          submission.effectOwner !== "none"
        ) {
          throw new OrivraMcpError("upstream_error", "Replay submission authority is invalid");
        }
        return {
          status: "success",
          summary: "Replay run was created and submitted without wallet or relayer authority.",
          runId: created.runId,
          operationId: id,
          resources: [link(`orivra://runs/${created.runId}`, `Run ${created.runId}`)],
          nextActions: ["inspect_run"],
        };
      } catch (error) {
        if (!(error instanceof OrivraMcpError) || error.type !== "pending") throw error;
        if (now() - startedAt >= replayReadyTimeoutMs) {
          return {
            status: "pending",
            summary: "Replay run is persisted and waiting for preflight readiness.",
            runId: created.runId,
            operationId: id,
            resources: [link(`orivra://runs/${created.runId}`, `Run ${created.runId}`)],
            nextActions: ["inspect_run", "create_replay_run"],
          };
        }
        await sleep(Math.min(1_000, replayReadyTimeoutMs));
      }
    }
  }

  async function verifyConsumer(request: { runId: string; operationId?: string }): Promise<CompactToolResult> {
    const runId = RunIdSchema.parse(request.runId);
    const id = operationId(request.operationId, generateUuid);
    const { value } = await api.requestValidated(
      `/runs/${encodeId(runId)}/consumer-verifications`,
      AcceptedCommandSchema,
      {
        method: "POST",
        body: { consumer: "canonical-vulnerable" },
        idempotencyKey: `${id}:verify-consumer`,
      },
    );
    if (value.runId !== runId) throw new OrivraMcpError("upstream_error", "Consumer command identity did not match the run");
    return {
      status: "pending",
      summary: "Canonical vulnerable-consumer diagnostics were accepted. No chain effect was requested.",
      runId,
      operationId: id,
      resources: [link(`orivra://runs/${runId}/consumer-lab`, `Run ${runId} Consumer Lab`)],
      nextActions: ["inspect_run"],
    };
  }

  async function generateSafeConsumer(request: {
    runId: string;
    operationId?: string;
    contractName?: string;
  }): Promise<CompactToolResult> {
    const runId = RunIdSchema.parse(request.runId);
    const id = operationId(request.operationId, generateUuid);
    const contractName = request.contractName === undefined
      ? undefined
      : z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).parse(request.contractName);
    const { value } = await api.requestValidated(
      `/runs/${encodeId(runId)}/artifacts/consumer`,
      GeneratedConsumerSchema,
      {
        method: "POST",
        body: contractName ? { contractName } : {},
        idempotencyKey: `${id}:generate-consumer`,
        maxBytes: 1_100_000,
      },
    );
    generatedConsumers.set(runId, value.source);
    const checksum = sha256Envelope(value.source);
    return {
      status: "success",
      summary: "Safe Solidity was generated. Read it through the linked resource.",
      runId,
      operationId: id,
      checksum,
      resources: [link(
        `orivra://runs/${runId}/safe-consumer`,
        `Run ${runId} safe consumer`,
        "text/x-solidity",
      )],
      nextActions: ["verify_consumer", "inspect_run"],
    };
  }

  async function validateRunBundle(request: { runId: string; operationId?: string }): Promise<CompactToolResult> {
    const runId = RunIdSchema.parse(request.runId);
    const id = operationId(request.operationId, generateUuid);
    const bundleText = await api.requestText(`/runs/${encodeId(runId)}/bundle`, {
      maxBytes: LARGE_RESOURCE_MAX_BYTES,
    });
    let decoded: unknown;
    try {
      decoded = JSON.parse(bundleText);
    } catch {
      throw new OrivraMcpError("upstream_error", "Orivra returned an invalid proof bundle");
    }
    const bundle = ProofBundleV1Schema.safeParse(decoded);
    if (!bundle.success || bundle.data.runId !== runId) {
      throw new OrivraMcpError("upstream_error", "Orivra returned an invalid proof bundle contract");
    }
    const { value } = await api.requestValidated("/replays", ReplayResultSchema, {
      method: "POST",
      body: { bundle: bundleText },
      idempotencyKey: `${id}:validate-bundle`,
    });
    if (value.runId !== runId) throw new OrivraMcpError("upstream_error", "Replay validation identity did not match the run");
    return {
      status: "success",
      summary: "The persisted proof bundle replayed byte-identically.",
      runId,
      operationId: id,
      checksum: value.checksum ?? bundle.data.checksum,
      resources: [link(`orivra://runs/${runId}/bundle`, `Run ${runId} bundle`)],
      nextActions: ["inspect_run"],
    };
  }

  async function readResource(uri: string): Promise<string> {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      throw new OrivraMcpError("invalid_arguments", "Orivra resource URI is invalid");
    }
    if (parsed.protocol !== "orivra:" || parsed.search || parsed.hash || parsed.username || parsed.password) {
      throw new OrivraMcpError("invalid_arguments", "Orivra resource URI is invalid");
    }
    const segments = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parsed.hostname === "templates" && segments.length === 3 && segments[2] === "manifest") {
      const detail = await templateDetail(segments[0]!, Number(segments[1]));
      return detail.manifestCanonicalJson;
    }
    if (parsed.hostname !== "runs" || segments.length < 1 || segments.length > 2) {
      throw new OrivraMcpError("not_found", "Orivra resource is not available");
    }
    const runId = RunIdSchema.parse(segments[0]);
    const kind = segments[1];
    if (!kind) {
      return (await api.requestValidated(`/runs/${encodeId(runId)}`, RunProjectionV1Schema)).text;
    }
    if (kind === "events") {
      return (await api.requestValidated(`/runs/${encodeId(runId)}/events`, EventsPageSchema, {
        maxBytes: LARGE_RESOURCE_MAX_BYTES,
      })).text;
    }
    if (kind === "preflight") {
      return (await api.requestValidated(`/runs/${encodeId(runId)}/preflight`, PreflightReportV1Schema)).text;
    }
    if (kind === "consumer-lab") {
      return (await api.requestValidated(`/runs/${encodeId(runId)}/consumer-lab`, ConsumerLabReportV1Schema, {
        maxBytes: 1_500_000,
      })).text;
    }
    if (kind === "receipt") {
      return (await api.requestValidated(`/runs/${encodeId(runId)}/receipt`, EvidenceReceiptV1Schema)).text;
    }
    if (kind === "bundle") {
      const text = await api.requestText(`/runs/${encodeId(runId)}/bundle`, {
        maxBytes: LARGE_RESOURCE_MAX_BYTES,
      });
      let decoded: unknown;
      try {
        decoded = JSON.parse(text);
      } catch {
        throw new OrivraMcpError("upstream_error", "Orivra returned an invalid proof bundle");
      }
      const parsedBundle = ProofBundleV1Schema.safeParse(decoded);
      if (!parsedBundle.success || parsedBundle.data.runId !== runId) {
        throw new OrivraMcpError("upstream_error", "Orivra returned an invalid proof bundle contract");
      }
      return text;
    }
    if (kind === "safe-consumer") {
      const cached = generatedConsumers.get(runId);
      if (cached) return cached;
      const { value } = await api.requestValidated(
        `/runs/${encodeId(runId)}/consumer-lab`,
        ConsumerLabReportV1Schema,
        { maxBytes: 1_500_000 },
      );
      generatedConsumers.set(runId, value.safeConsumer.source);
      return value.safeConsumer.source;
    }
    throw new OrivraMcpError("not_found", "Orivra resource is not available");
  }

  return Object.freeze({
    listTemplates,
    getTemplate,
    listRuns,
    inspectRun,
    createReplayRun,
    verifyConsumer,
    generateSafeConsumer,
    validateRunBundle,
    readResource,
  });
}

export type OrivraMcpRuntime = ReturnType<typeof createOrivraMcpRuntime>;
