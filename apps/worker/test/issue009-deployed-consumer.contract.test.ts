import { describe, expect, it } from "vitest";
import { classifyDeployedConsumerObservation } from "../src/deployed-consumer-verifier";
import { createProductionCommandHandlers } from "../src/worker";
import { compileGeneratedConsumer } from "../src/solidity-compiler";
import { generateSafeWeb2JsonConsumer, projectRun } from "@proofline/domain";
import { makeRunEvents, RUN_ID, validManifest } from "../../../packages/contracts/test/fixtures";
import { vi } from "vitest";

const expected = "0x6001600055";
const proxy = "0x363d3d373d3d3d363d73" + "11".repeat(20) + "5af43d82803e903d91602b57fd5bf3";

function deploymentContext() {
  const source = generateSafeWeb2JsonConsumer(validManifest, { contractName: "ProoflineSafeWeb2JsonConsumer" });
  const compilation = compileGeneratedConsumer(source);
  const events = makeRunEvents();
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  return {
    compilation,
    context: {
      runId: RUN_ID,
      projectId: "11111111-1111-4111-8111-111111111111",
      manifest: validManifest,
      events,
      projection: projectRun(events),
      artifacts: [
        { kind: "preflight-evidence", canonicalBytes: encode({
          canonicalUrl: validManifest.request.url,
          requestBytes: "0x1234", requestCalldata: "0x1234", quotedFeeWei: "1",
          network: { chainId: 114, blockNumber: "120", registryAddress: "0x2222222222222222222222222222222222222222",
            resolvedContracts: { FdcHub: "0x3333333333333333333333333333333333333333", FdcRequestFeeConfigurations: "0x4444444444444444444444444444444444444444", FdcVerification: "0x5555555555555555555555555555555555555555", Relay: "0x6666666666666666666666666666666666666666" } },
        }) },
        { kind: "safe-consumer", canonicalBytes: new TextEncoder().encode(source), metadata: compilation },
      ],
    },
  };
}

describe("Issue #9 read-only deployed consumer classification", () => {
  it.each([
    [expected, "verified"],
    ["0x6002600055", "mismatched"],
    ["0x", "unavailable"],
    [proxy, "proxy-unsupported"],
  ] as const)("classifies %s as %s", (observed, status) => {
    expect(classifyDeployedConsumerObservation({
      runId: "01900000-0000-4000-8000-000000000009",
      commandId: "verify-deployed",
      address: "0x1111111111111111111111111111111111111111",
      observedAt: "2026-08-16T00:00:00.000Z",
      blockNumber: "123",
      registryAddress: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
      observedRuntimeBytecode: observed,
      expectedRuntimeBytecode: expected,
      sourceSha256: `sha256:${"a".repeat(64)}`,
      compilerVersion: "solc-0.8.36",
    }).status).toBe(status);
  });

  it("rejects a mismatched chain or registry before classification", () => {
    expect(() => classifyDeployedConsumerObservation({
      runId: "01900000-0000-4000-8000-000000000009",
      commandId: "verify-deployed",
      chainId: 14,
      address: "0x1111111111111111111111111111111111111111",
      observedAt: "2026-08-16T00:00:00.000Z",
      blockNumber: "123",
      registryAddress: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
      expectedRegistryAddress: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
      observedRuntimeBytecode: expected,
      expectedRuntimeBytecode: expected,
      sourceSha256: `sha256:${"a".repeat(64)}`,
      compilerVersion: "solc-0.8.36",
    })).toThrow(/chain/i);

    const base = {
      runId: "01900000-0000-4000-8000-000000000009",
      commandId: "verify-deployed",
      address: "0x1111111111111111111111111111111111111111",
      observedAt: "2026-08-16T00:00:00.000Z",
      blockNumber: "123",
      registryAddress: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
      observedRuntimeBytecode: expected,
      expectedRuntimeBytecode: expected,
      sourceSha256: `sha256:${"a".repeat(64)}`,
      compilerVersion: "solc-0.8.36",
    };
    expect(() => classifyDeployedConsumerObservation({
      ...base,
      expectedRegistryAddress: "0x2222222222222222222222222222222222222222",
    })).toThrow(/registry/i);
    expect(() => classifyDeployedConsumerObservation({
      ...base,
      observedRuntimeBytecode: "not-bytecode",
    })).toThrow(/bytecode/i);
  });

  it("binds terminal safe source, persisted registry and one read-only observation into an artifact without lifecycle events", async () => {
    const { compilation, context } = deploymentContext();
    const observeDeployedConsumer = vi.fn().mockResolvedValue({
      chainId: 114, registryAddress: "0x2222222222222222222222222222222222222222",
      blockNumber: "123", runtimeBytecode: compilation.runtimeBytecode,
    });
    const handlers = createProductionCommandHandlers({
      repository: { loadRunExecutionContext: vi.fn().mockResolvedValue(context) } as any,
      ports: { observeDeployedConsumer } as any,
      clock: { now: () => "2026-08-16T00:00:00.000Z" },
    });
    const result = await handlers.VERIFY_DEPLOYED_CONSUMER({
      id: "verify-deployed", kind: "VERIFY_DEPLOYED_CONSUMER", runId: RUN_ID,
      payload: { version: "1", chainId: 114, address: "0x1111111111111111111111111111111111111111" },
    });
    expect(observeDeployedConsumer).toHaveBeenCalledOnce();
    expect(result.events).toBeUndefined();
    expect(result.artifacts).toEqual([expect.objectContaining({ kind: "deployed-consumer-evidence-v1" })]);
    const persisted = JSON.parse(new TextDecoder().decode(result.artifacts?.[0].canonicalBytes));
    expect(persisted).toMatchObject({ status: "verified", blockNumber: "123", chainId: 114 });
  });

  it("fails before observation for nonterminal runs, missing ports, and contradictory compiler evidence", async () => {
    const command = {
      id: "verify-deployed", kind: "VERIFY_DEPLOYED_CONSUMER", runId: RUN_ID,
      payload: { version: "1", chainId: 114, address: "0x1111111111111111111111111111111111111111" },
    };
    const ready = deploymentContext().context;
    const handlers = (context: unknown, ports: Record<string, unknown> = {}) => createProductionCommandHandlers({
      repository: { loadRunExecutionContext: vi.fn().mockResolvedValue(context) } as any,
      ports: ports as any,
      clock: { now: () => "2026-08-16T00:00:00.000Z" },
    });

    await expect(handlers({ ...ready, events: ready.events.slice(0, -1) })
      .VERIFY_DEPLOYED_CONSUMER(command)).rejects.toMatchObject({ code: "DEPLOYED_CONSUMER_NOT_READY" });
    await expect(handlers(ready).VERIFY_DEPLOYED_CONSUMER(command)).rejects.toThrow(/observer is unavailable/i);
    const wrongCompiler = {
      ...ready,
      artifacts: ready.artifacts.map((item) => item.kind === "safe-consumer"
        ? { ...item, metadata: { ...item.metadata, compiledSourceSha256: `sha256:${"0".repeat(64)}` } }
        : item),
    };
    await expect(handlers(wrongCompiler, { observeDeployedConsumer: vi.fn() })
      .VERIFY_DEPLOYED_CONSUMER(command)).rejects.toThrow(/compiler evidence/i);
  });
});
