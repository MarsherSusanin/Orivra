import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  getWeb2JsonTemplateCatalog,
  getWeb2JsonTemplateDetail,
} from "@proofline/domain/templates";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOrivraMcpRuntime,
  createOrivraMcpServer,
} from "../src/index";

const TOKEN = `project_${"d".repeat(64)}`;
const opened: Array<{ client: Client; server: ReturnType<typeof createOrivraMcpServer> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map(async ({ client, server }) => {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }));
});

async function connectedClient(fetch: typeof globalThis.fetch) {
  const runtime = createOrivraMcpRuntime({
    configuration: { apiUrl: "https://orivra.xyz/api/v1", projectToken: TOKEN },
    fetch,
  });
  const server = createOrivraMcpServer(runtime);
  const client = new Client({ name: "orivra-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  opened.push({ client, server });
  return client;
}

describe("Orivra MCP protocol surface", () => {
  it("advertises only the eight bounded tools and no wallet, relayer, or open HTTP tool", async () => {
    const client = await connectedClient(vi.fn(async () => {
      throw new Error("Unexpected API request");
    }) as typeof globalThis.fetch);

    const listed = await client.listTools();
    expect(listed.tools.map(({ name }) => name)).toEqual([
      "list_templates",
      "get_template",
      "list_runs",
      "inspect_run",
      "create_replay_run",
      "verify_consumer",
      "generate_safe_consumer",
      "validate_run_bundle",
    ]);
    expect(listed.tools.map(({ name }) => name).join(" "))
      .not.toMatch(/private.?key|wallet|relayer|call_api|http_request/i);
    expect(listed.tools.find(({ name }) => name === "create_replay_run")?.annotations)
      .toMatchObject({ destructiveHint: false, idempotentHint: true, openWorldHint: false });

    const resources = await client.listResourceTemplates();
    expect(resources.resourceTemplates.map(({ uriTemplate }) => uriTemplate)).toEqual([
      "orivra://templates/{templateId}/{revision}/manifest",
      "orivra://runs/{runId}",
      "orivra://runs/{runId}/{kind}",
    ]);
  });

  it("returns compact structured output and reads canonical template bytes only through a resource", async () => {
    const catalog = getWeb2JsonTemplateCatalog();
    const detail = getWeb2JsonTemplateDetail("open-meteo-current-weather")!;
    const fetch = vi.fn(async (request: string | URL | Request) => {
      const pathname = new URL(String(request)).pathname;
      if (pathname.endsWith("/templates")) return Response.json(catalog);
      if (pathname.endsWith("/templates/open-meteo-current-weather")) {
        return Response.json(detail);
      }
      return Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
    });
    const client = await connectedClient(fetch as typeof globalThis.fetch);

    const templates = await client.callTool({ name: "list_templates", arguments: {} });
    expect(templates.isError).not.toBe(true);
    expect(templates.structuredContent).toMatchObject({ status: "success" });
    expect(JSON.stringify(templates.structuredContent)).not.toContain(detail.manifestCanonicalJson);

    const loaded = await client.callTool({
      name: "get_template",
      arguments: { template_id: detail.template.id, revision: detail.template.revision },
    });
    const links = loaded.content.filter((item) => item.type === "resource_link");
    expect(links).toEqual([
      expect.objectContaining({
        uri: `orivra://templates/${detail.template.id}/${detail.template.revision}/manifest`,
      }),
    ]);
    const resource = await client.readResource({ uri: links[0]!.uri });
    expect(resource.contents).toEqual([
      expect.objectContaining({ text: detail.manifestCanonicalJson, mimeType: "application/json" }),
    ]);
  });

  it("returns schema failures as structured MCP errors without making an API call", async () => {
    const fetch = vi.fn();
    const client = await connectedClient(fetch as typeof globalThis.fetch);
    const rejected = await client.callTool({
      name: "create_replay_run",
      arguments: {
        source_kind: "manifest",
        manifest: { submission: { mode: "wallet" }, privateKey: "never" },
      },
    });
    expect(rejected).toMatchObject({
      isError: true,
      structuredContent: {
        status: "error",
        errorType: "invalid_arguments",
        summary: "Tool arguments did not match the Orivra contract",
      },
    });
    expect(JSON.stringify(rejected)).not.toContain("never");
    expect(fetch).not.toHaveBeenCalled();
  });
});
