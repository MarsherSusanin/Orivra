import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import { OrivraMcpError } from "./api-client";
import type { CompactToolResult, OrivraMcpRuntime } from "./runtime";

const OperationId = z.string().min(1).max(180).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).optional();
const RunId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

function resourceContentType(uri: string): "application/json" | "text/x-solidity" {
  return uri.endsWith("/safe-consumer") ? "text/x-solidity" : "application/json";
}

function toolResult(value: CompactToolResult & Record<string, unknown>) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(value) },
      ...(value.resources ?? []).map((resource) => ({
        type: "resource_link" as const,
        uri: resource.uri,
        name: resource.name,
        mimeType: resource.mimeType,
      })),
    ],
    structuredContent: value,
  };
}

function toolFailure(error: unknown) {
  const known = error instanceof OrivraMcpError
    ? error
    : new OrivraMcpError(
        "invalid_arguments",
        error instanceof z.ZodError
          ? "Tool arguments did not match the Orivra contract"
          : "Tool call failed",
      );
  const value = {
    status: "error" as const,
    summary: known.message,
    errorType: known.type,
    nextActions: known.type === "unauthorized"
      ? ["Create or replace the CLI / MCP project token in Orivra Settings"]
      : known.type === "pending"
        ? ["inspect_run"]
        : [],
  };
  return { ...toolResult(value), isError: true };
}

function guarded<T extends Record<string, unknown>>(
  callback: () => Promise<CompactToolResult & T>,
) {
  return callback().then(toolResult, toolFailure);
}

async function readResourceSafely(runtime: OrivraMcpRuntime, uri: string): Promise<string> {
  try {
    return await runtime.readResource(uri);
  } catch (error) {
    if (error instanceof OrivraMcpError) throw error;
    throw new OrivraMcpError("invalid_arguments", "Orivra resource request is invalid");
  }
}

export function createOrivraMcpServer(runtime: OrivraMcpRuntime): McpServer {
  const server = new McpServer({ name: "orivra", version: "0.1.0" });
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  const internalWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  server.registerTool("list_templates", {
    title: "List Orivra templates",
    description: "List the bounded built-in Web2Json templates. This performs no mutation.",
    inputSchema: z.object({}).strict(),
    annotations: readOnly,
  }, () => guarded(() => runtime.listTemplates()));

  server.registerTool("get_template", {
    title: "Get an Orivra template",
    description: "Load one exact built-in template revision and return its manifest as a resource link.",
    inputSchema: z.object({
      template_id: z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      revision: z.number().int().positive().safe(),
    }).strict(),
    annotations: readOnly,
  }, ({ template_id, revision }) => guarded(() => runtime.getTemplate({ templateId: template_id, revision })));

  server.registerTool("list_runs", {
    title: "List Orivra runs",
    description: "List project-scoped persisted runs. This performs no mutation.",
    inputSchema: z.object({
      status: z.enum(["active", "completed", "failed"]).optional(),
      cursor: z.string().min(16).max(1024).regex(/^[A-Za-z0-9_-]+$/).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }).strict(),
    annotations: readOnly,
  }, (args) => guarded(() => runtime.listRuns(args)));

  server.registerTool("inspect_run", {
    title: "Inspect an Orivra run",
    description: "Read the six-stage persisted projection and link only evidence currently available.",
    inputSchema: z.object({ run_id: RunId }).strict(),
    annotations: readOnly,
  }, ({ run_id }) => guarded(() => runtime.inspectRun({ runId: run_id })));

  server.registerTool("create_replay_run", {
    title: "Create a replay-only Orivra run",
    description: "Persist and submit a replay run. The server forcibly removes wallet and relayer authority.",
    inputSchema: z.discriminatedUnion("source_kind", [
      z.object({
        source_kind: z.literal("template"),
        template_id: z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        revision: z.number().int().positive().safe(),
        operation_id: OperationId,
      }).strict(),
      z.object({
        source_kind: z.literal("manifest"),
        manifest: z.unknown(),
        operation_id: OperationId,
      }).strict(),
    ]),
    annotations: internalWrite,
  }, (args) => guarded(() => runtime.createReplayRun({
    source: args.source_kind === "template"
      ? { kind: "template", templateId: args.template_id, revision: args.revision }
      : { kind: "manifest", manifest: args.manifest as never },
    operationId: args.operation_id,
  })));

  server.registerTool("verify_consumer", {
    title: "Diagnose the canonical vulnerable consumer",
    description: "Persist canonical vulnerable-consumer diagnostics. This is an internal command with no chain effect.",
    inputSchema: z.object({ run_id: RunId, operation_id: OperationId }).strict(),
    annotations: internalWrite,
  }, ({ run_id, operation_id }) => guarded(() => runtime.verifyConsumer({ runId: run_id, operationId: operation_id })));

  server.registerTool("generate_safe_consumer", {
    title: "Generate safe Solidity",
    description: "Generate the bounded safe Solidity replacement and return it only through a resource link.",
    inputSchema: z.object({
      run_id: RunId,
      operation_id: OperationId,
      contract_name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
    }).strict(),
    annotations: internalWrite,
  }, ({ run_id, operation_id, contract_name }) => guarded(() => runtime.generateSafeConsumer({
    runId: run_id,
    operationId: operation_id,
    contractName: contract_name,
  })));

  server.registerTool("validate_run_bundle", {
    title: "Validate a persisted Orivra bundle",
    description: "Replay-validate one persisted bundle internally without returning the large bundle to model context.",
    inputSchema: z.object({ run_id: RunId, operation_id: OperationId }).strict(),
    annotations: internalWrite,
  }, ({ run_id, operation_id }) => guarded(() => runtime.validateRunBundle({ runId: run_id, operationId: operation_id })));

  server.registerResource(
    "template-manifest",
    new ResourceTemplate("orivra://templates/{templateId}/{revision}/manifest", { list: undefined }),
    { title: "Orivra template manifest", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: await readResourceSafely(runtime, uri.href) }] }),
  );
  server.registerResource(
    "run",
    new ResourceTemplate("orivra://runs/{runId}", { list: undefined }),
    { title: "Orivra run", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: await readResourceSafely(runtime, uri.href) }] }),
  );
  server.registerResource(
    "run-evidence",
    new ResourceTemplate("orivra://runs/{runId}/{kind}", { list: undefined }),
    { title: "Orivra run evidence" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: resourceContentType(uri.href), text: await readResourceSafely(runtime, uri.href) }] }),
  );
  return server;
}
