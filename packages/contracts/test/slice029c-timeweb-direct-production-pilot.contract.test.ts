// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const OPEN_METEO = "sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898";
const ETH_USD = "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db";
const OPEN_METEO_RELAYER = "sha256:1fb914f985c85333292f1d4a278010ff7e94d3459b95974f8d47eb70d0f7cfe6";
const ETH_USD_RELAYER = "sha256:eaed1554eb215de798f3acc0a3936b469529595e563630e7cb1ae5defbd57f9f";
const sha = (digit: string) => `sha256:${digit.repeat(64).slice(0, 64)}`;
const repositories = [
  ["caddy", "ghcr.io/marshersusanin/orivra-caddy"],
  ["web", "ghcr.io/marshersusanin/orivra-web"],
  ["api", "ghcr.io/marshersusanin/orivra-api"],
  ["worker", "ghcr.io/marshersusanin/orivra-worker"],
  ["postgres-recovery", "ghcr.io/marshersusanin/orivra-postgres-recovery"],
] as const;
const historicalGhcrImages = [
  ["caddy", "ghcr.io/marshersusanin/orivra-caddy", "cc394659cd7962ef02cfb2faf341334f4baef1f16f0fd776bbd8354e10270fe1"],
  ["web", "ghcr.io/marshersusanin/orivra-web", "581d85c7ca0e8445843cce0e1d948a09a2a7b8a4b523d694f717ca1769934513"],
  ["api", "ghcr.io/marshersusanin/orivra-api", "c1a4e45a3982c45259ecbec48bf449ccdb5e9817b364bed7e6cf01f41eaddd33"],
  ["worker", "ghcr.io/marshersusanin/orivra-worker", "4a9599fb40a863c3aeb59d35f56b34e4283bdf7745f5b1e2117c8b864f39f396"],
  ["postgres-recovery", "ghcr.io/marshersusanin/orivra-postgres-recovery", "aadd4aba5f0386f1182cffb2301f55d7fbd90121f5e8b929ed1d19977083b962"],
].map(([id, remoteRepository, digest]) => ({
  id,
  remoteReference: `${remoteRepository}@sha256:${digest}`,
  remoteDigest: `sha256:${digest}`,
}));
const currentGhcrImages = repositories.map(([id, remoteRepository], index) => ({
  id,
  remoteReference: `${remoteRepository}@${sha(String.fromCharCode(97 + index))}`,
  remoteDigest: sha(String.fromCharCode(97 + index)),
}));
const timewebCapabilities = ["PUT", "HEAD", "LIST", "GET", "DELETE"]
  .map((operation) => ({ operation, status: "passed" }));
const clockCheck = {
  status: "synchronized", source: "production-host",
  maximumSkewSeconds: 5, observedSkewSeconds: 0,
};
const canonicalJson = (value: any): string => value === null || typeof value !== "object"
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonicalJson).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
const checksum = (value: any) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

async function feature(): Promise<Record<string, any>> {
  const path = "../src/production-promotion";
  return import(/* @vite-ignore */ path).catch(() => ({}));
}

const timewebAuthority = {
  version: "1",
  kind: "timeweb-s3-pilot-authority",
  provider: "timeweb-s3",
  endpoint: "https://s3.twcstorage.ru",
  region: "ru-1",
  bucket: "orivra-backet",
  pathStyle: true,
  authorityMode: "shared-pilot",
  credentialDelivery: "secret-files",
  qaProvider: "minio-only",
  swiftRuntime: false,
};

const safeConsumers = {
  version: "1",
  kind: "safe-consumer-registry",
  chainId: 114,
  entries: [
    { templateId: "open-meteo-current-weather", revision: 1, manifestSha256: OPEN_METEO, consumerAddress: "0x1111111111111111111111111111111111111111" },
    { templateId: "eth-usd", revision: 1, manifestSha256: ETH_USD, consumerAddress: "0x2222222222222222222222222222222222222222" },
  ],
};

describe("Slice 029C Timeweb direct-production pilot contracts", () => {
  it("retains V1 history and exports exact canonical V2 pilot authority", async () => {
    const module = await feature();
    for (const name of [
      "ProductionPromotionAuthorizationV1Schema",
      "ProductionDeploymentEvidenceV1Schema",
      "ProductionPromotionEvidenceV1Schema",
      "ApplicationRollbackAuthorizationV1Schema",
      "TimewebS3PilotAuthorityV1Schema",
      "SafeConsumerRegistryV1Schema",
      "SafeConsumerDeploymentEvidenceV1Schema",
      "ProductionPilotPreflightEvidenceV1Schema",
      "ProductionTargetV2Schema",
      "ProductionPromotionAuthorizationV2Schema",
      "ProductionDeploymentEvidenceV2Schema",
      "ProductionCanaryCheckpointV2Schema",
      "ProductionPromotionEvidenceV2Schema",
      "ApplicationRollbackAuthorizationV2Schema",
    ]) expect(module[name], name).toBeDefined();
  });

  it("accepts only exact shared-pilot Timeweb S3 and keeps MinIO QA-only and Swift absent", async () => {
    const module = await feature();
    expect(module.TimewebS3PilotAuthorityV1Schema.parse(timewebAuthority)).toEqual(timewebAuthority);
    expect(module.canonicalSerializeTimewebS3PilotAuthority(timewebAuthority)).toBe(canonicalJson(timewebAuthority));
    expect(module.checksumTimewebS3PilotAuthority(timewebAuthority)).toBe(checksum(timewebAuthority));
    for (const invalid of [
      { ...timewebAuthority, endpoint: "https://ru-1.digitaloceanspaces.com" },
      { ...timewebAuthority, endpoint: "http://s3.twcstorage.ru" },
      { ...timewebAuthority, region: "ru-2" },
      { ...timewebAuthority, bucket: "orivra-bucket" },
      { ...timewebAuthority, pathStyle: false },
      { ...timewebAuthority, authorityMode: "separated" },
      { ...timewebAuthority, qaProvider: "minio-production" },
      { ...timewebAuthority, swiftRuntime: true },
      { ...timewebAuthority, secretAccessKey: "forbidden" },
      { ...timewebAuthority, rotationDeadline: "2026-09-01T00:00:00Z" },
    ]) expect(() => module.TimewebS3PilotAuthorityV1Schema.parse(invalid)).toThrow();
  });

  it("binds exactly two ordered manifests to two distinct nonzero safe-consumer addresses", async () => {
    const module = await feature();
    expect(module.SafeConsumerRegistryV1Schema.parse(safeConsumers)).toEqual(safeConsumers);
    expect(module.canonicalSerializeSafeConsumerRegistry(safeConsumers)).toBe(canonicalJson(safeConsumers));
    expect(module.checksumSafeConsumerRegistry(safeConsumers)).toBe(checksum(safeConsumers));
    for (const invalid of [
      { ...safeConsumers, entries: [...safeConsumers.entries].reverse() },
      { ...safeConsumers, entries: [safeConsumers.entries[0]] },
      { ...safeConsumers, entries: safeConsumers.entries.map((entry, index) => index ? { ...entry, manifestSha256: OPEN_METEO } : entry) },
      { ...safeConsumers, entries: safeConsumers.entries.map((entry, index) => index ? { ...entry, consumerAddress: safeConsumers.entries[0].consumerAddress } : entry) },
      { ...safeConsumers, entries: safeConsumers.entries.map((entry, index) => index ? { ...entry, consumerAddress: "0x0000000000000000000000000000000000000000" } : entry) },
    ]) expect(() => module.SafeConsumerRegistryV1Schema.parse(invalid)).toThrow();
  });

  it("binds canonical deployment evidence to pinned solc, official Coston2 imports and the exact registry", async () => {
    const module = await feature();
    const evidence = {
      version: "1",
      kind: "safe-consumer-deployment-evidence",
      status: "passed",
      chainId: 114,
      compiler: {
        name: "solc",
        version: "0.8.36",
        importAuthority: "official-coston2-contract-registry",
      },
      relayer: {
        address: "0x3333333333333333333333333333333333333333",
        balanceBeforeWei: "1000000000000000000",
        requiredBalanceWei: "4000000000000000",
      },
      registrySha256: checksum(safeConsumers),
      deployments: safeConsumers.entries.map((entry, index) => ({
        ...entry,
        contractName: index === 0
          ? "OrivraOpenMeteoCurrentWeatherConsumer"
          : "OrivraEthUsdConsumer",
        compiledSourceSha256: sha(String(index + 1)),
        bytecodeSha256: sha(String(index + 3)),
        transactionHash: `0x${String(index + 5).repeat(64)}`,
        blockNumber: String(index + 100),
        runtimeCodeSha256: sha(String(index + 7)),
      })),
      completedAt: "2026-08-12T04:00:00Z",
    };
    expect(module.SafeConsumerDeploymentEvidenceV1Schema.parse(evidence)).toEqual(evidence);
    expect(module.canonicalSerializeSafeConsumerDeploymentEvidence(evidence)).toBe(canonicalJson(evidence));
    expect(module.checksumSafeConsumerDeploymentEvidence(evidence)).toBe(checksum(evidence));
    for (const invalid of [
      { ...evidence, chainId: 1 },
      { ...evidence, deployments: [...evidence.deployments].reverse() },
      { ...evidence, registrySha256: sha("9") },
      { ...evidence, compiler: { ...evidence.compiler, version: "0.8.35" } },
      { ...evidence, relayer: { ...evidence.relayer, privateKey: "forbidden" } },
      { ...evidence, deployments: evidence.deployments.map((entry, index) => index ? { ...entry, consumerAddress: evidence.deployments[0].consumerAddress } : entry) },
    ]) expect(() => module.SafeConsumerDeploymentEvidenceV1Schema.parse(invalid)).toThrow();
  });

  it("removes staging from strict direct-pilot V2 authorization while retaining exact publication authority", async () => {
    const module = await feature();
    const target = {
      version: "2", kind: "digitalocean-production-target", provider: "digitalocean", environment: "production",
      deploymentMode: "direct-pilot", deploymentId: "orivra-production-primary", composeProject: "proofline-production-primary",
      publicOrigin: "https://orivra.xyz", dnsName: "orivra.xyz",
      sshEndpoint: { host: "72.56.81.28", port: 22, hostKeySha256: sha("1") }, ingress: [80, 443],
      objectStore: timewebAuthority,
    };
    const authorization = {
      version: "2", kind: "production-promotion-authorization", status: "authorized", promote: true,
      deploymentMode: "direct-pilot", publicationEvidenceSha256: sha("2"), productionTargetSha256: checksum(target),
      objectStoreAuthoritySha256: checksum(timewebAuthority),
      operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
      authorizedAt: "2026-08-12T02:10:00Z", expiresAt: "2026-08-12T02:40:00Z",
    };
    expect(module.ProductionTargetV2Schema.parse(target)).toEqual(target);
    expect(module.ProductionPromotionAuthorizationV2Schema.parse(authorization)).toEqual(authorization);
    expect(module.checksumProductionTargetV2(target)).toBe(checksum(target));
    expect(module.checksumProductionPromotionAuthorizationV2(authorization)).toBe(checksum(authorization));
    expect(() => module.ProductionPromotionAuthorizationV2Schema.parse({ ...authorization, stagingDeploymentEvidenceSha256: sha("3") })).toThrow();
    for (const publicOrigin of [
      "http://orivra.xyz", "https://user@orivra.xyz", "https://user:pass@orivra.xyz",
      "https://orivra.xyz/path", "https://orivra.xyz/?query=1", "https://orivra.xyz/#fragment",
      "https://www.orivra.xyz",
    ]) expect(() => module.ProductionTargetV2Schema.parse({ ...target, publicOrigin })).toThrow();
  });

  it("requires exact typed preflight observations instead of status-only success", async () => {
    const module = await feature();
    const evidence = {
      version: "1", kind: "production-pilot-preflight-evidence", status: "passed",
      targetSha256: sha("1"), objectStoreAuthoritySha256: checksum(timewebAuthority),
      checks: [
        { check: "dns-target", status: "passed", dnsName: "orivra.xyz", addresses: ["72.56.81.28"] },
        { check: "ssh-host-key", status: "passed", host: "72.56.81.28", port: 22, expectedHostKeySha256: sha("2"), observedHostKeySha256: sha("2") },
        { check: "read-only-ghcr", status: "passed", registry: "ghcr.io", access: "read-only", images: currentGhcrImages },
        { check: "secret-files", status: "passed", fileIdsSha256: sha("3"), valuesExposed: false },
        {
          check: "timeweb-s3-authority", status: "passed", authoritySha256: checksum(timewebAuthority),
          authorityMode: "shared-pilot", endpoint: timewebAuthority.endpoint, region: timewebAuthority.region,
          bucket: timewebAuthority.bucket, pathStyle: true, capabilities: timewebCapabilities,
        },
        { check: "replay-bundle", status: "passed", bundleSha256: sha("4"), reportSha256: sha("5") },
        { check: "safe-consumer-manifests", status: "passed", registrySha256: checksum(safeConsumers), manifests: [["open-meteo-current-weather", OPEN_METEO], ["eth-usd", ETH_USD]] },
        {
          check: "live-coston2", status: "passed", chainId: 114,
          rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
          dataAvailabilityUrl: "https://ctn2-data-availability.flare.network",
          relayerAddress: "0x3333333333333333333333333333333333333333",
          balanceWei: "1000000000000000000", authorization: "configured",
        },
      ],
    };
    expect(module.ProductionPilotPreflightEvidenceV1Schema.parse(evidence)).toEqual(evidence);
    expect(module.canonicalSerializeProductionPilotPreflightEvidence(evidence)).toBe(canonicalJson(evidence));
    expect(module.checksumProductionPilotPreflightEvidence(evidence)).toBe(checksum(evidence));
    const evidenceV2 = {
      ...evidence,
      version: "2",
      checks: evidence.checks.filter((value) => value.check !== "replay-bundle"),
    };
    expect(module.ProductionPilotPreflightEvidenceV2Schema.parse(evidenceV2)).toEqual(evidenceV2);
    expect(module.canonicalSerializeProductionPilotPreflightEvidenceV2(evidenceV2)).toBe(canonicalJson(evidenceV2));
    expect(module.checksumProductionPilotPreflightEvidenceV2(evidenceV2)).toBe(checksum(evidenceV2));
    expect(module.ProductionPilotPreflightEvidenceV1Schema.parse({
      ...evidence,
      checks: evidence.checks.map((value) => value.check === "read-only-ghcr"
        ? { ...value, images: historicalGhcrImages }
        : value),
    })).toBeDefined();
    expect(() => module.ProductionPilotPreflightEvidenceV1Schema.parse({ ...evidence, checks: evidence.checks.map(() => ({ status: "passed" })) })).toThrow();
    expect(() => module.ProductionPilotPreflightEvidenceV1Schema.parse({ ...evidence, checks: evidence.checks.slice(0, 7) })).toThrow();
    const replaceCheck = (id: string, transform: (value: any) => any) => ({
      ...evidence,
      checks: evidence.checks.map((value) => value.check === id ? transform(value) : value),
    });
    for (const invalid of [
      replaceCheck("read-only-ghcr", ({ images: _images, ...value }) => value),
      replaceCheck("read-only-ghcr", (value) => ({ ...value, images: [...value.images, value.images[0]] })),
      replaceCheck("read-only-ghcr", (value) => ({ ...value, images: [...value.images].reverse() })),
      replaceCheck("read-only-ghcr", (value) => ({ ...value, images: value.images.map((image: any, index: number) => index ? image : { ...image, remoteDigest: sha("0") }) })),
      replaceCheck("read-only-ghcr", (value) => ({ ...value, images: value.images.map((image: any, index: number) => index ? image : { ...image, remoteReference: `ghcr.io/evil/other@${image.remoteDigest}` }) })),
      replaceCheck("timeweb-s3-authority", ({ capabilities: _capabilities, ...value }) => value),
      replaceCheck("timeweb-s3-authority", (value) => ({ ...value, capabilities: [...value.capabilities, { operation: "COPY", status: "passed" }] })),
      replaceCheck("timeweb-s3-authority", (value) => ({ ...value, capabilities: value.capabilities.map((capability: any) => capability.operation === "GET" ? { ...capability, status: "failed" } : capability) })),
      replaceCheck("timeweb-s3-authority", (value) => ({ ...value, endpoint: "https://example.invalid" })),
      replaceCheck("live-coston2", ({ rpcUrl: _rpcUrl, ...value }) => value),
      replaceCheck("live-coston2", (value) => ({ ...value, extraEndpoint: "https://example.invalid" })),
      replaceCheck("live-coston2", (value) => ({ ...value, chainId: 1 })),
      replaceCheck("live-coston2", (value) => ({ ...value, rpcUrl: "https://example.invalid/rpc" })),
      replaceCheck("live-coston2", (value) => ({ ...value, dataAvailabilityUrl: "https://example.invalid" })),
      replaceCheck("live-coston2", (value) => ({ ...value, balanceWei: "1e18" })),
    ]) expect(() => module.ProductionPilotPreflightEvidenceV1Schema.parse(invalid)).toThrow();
  });

  it("keeps V2 publication identity dynamic while fixing only ordered canonical GHCR repositories", async () => {
    const module = await feature();
    const target = {
      version: "2", kind: "digitalocean-production-target", provider: "digitalocean", environment: "production",
      deploymentMode: "direct-pilot", deploymentId: "orivra-production-primary", composeProject: "proofline-production-primary",
      publicOrigin: "https://orivra.xyz", dnsName: "orivra.xyz",
      sshEndpoint: { host: "72.56.81.28", port: 22, hostKeySha256: sha("1") }, ingress: [80, 443], objectStore: timewebAuthority,
    };
    for (const publicationEvidenceSha256 of [sha("2"), sha("9")]) {
      expect(module.ProductionPromotionAuthorizationV2Schema.parse({
        version: "2", kind: "production-promotion-authorization", status: "authorized", promote: true,
        deploymentMode: "direct-pilot", publicationEvidenceSha256,
        productionTargetSha256: checksum(target), objectStoreAuthoritySha256: checksum(timewebAuthority),
        operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
        authorizedAt: "2026-08-12T02:10:00Z", expiresAt: "2026-08-12T02:40:00Z",
      })).toBeDefined();
    }
    const currentEvidence = {
      version: "1", kind: "production-pilot-preflight-evidence", status: "passed",
      targetSha256: sha("1"), objectStoreAuthoritySha256: checksum(timewebAuthority),
      checks: [
        { check: "dns-target", status: "passed", dnsName: "orivra.xyz", addresses: ["72.56.81.28"] },
        { check: "ssh-host-key", status: "passed", host: "72.56.81.28", port: 22, expectedHostKeySha256: sha("2"), observedHostKeySha256: sha("2") },
        { check: "read-only-ghcr", status: "passed", registry: "ghcr.io", access: "read-only", images: currentGhcrImages },
        { check: "secret-files", status: "passed", fileIdsSha256: sha("3"), valuesExposed: false },
        { check: "timeweb-s3-authority", status: "passed", authoritySha256: checksum(timewebAuthority), authorityMode: "shared-pilot", endpoint: timewebAuthority.endpoint, region: timewebAuthority.region, bucket: timewebAuthority.bucket, pathStyle: true, capabilities: timewebCapabilities },
        { check: "replay-bundle", status: "passed", bundleSha256: sha("4"), reportSha256: sha("5") },
        { check: "safe-consumer-manifests", status: "passed", registrySha256: checksum(safeConsumers), manifests: [["open-meteo-current-weather", OPEN_METEO], ["eth-usd", ETH_USD]] },
        { check: "live-coston2", status: "passed", chainId: 114, rpcUrl: "https://coston2-api.flare.network/ext/C/rpc", dataAvailabilityUrl: "https://ctn2-data-availability.flare.network", relayerAddress: "0x3333333333333333333333333333333333333333", balanceWei: "1000000000000000000", authorization: "configured" },
      ],
    };
    expect(module.ProductionPilotPreflightEvidenceV1Schema.parse(currentEvidence)).toEqual(currentEvidence);
    for (const invalid of [
      currentGhcrImages.map((image, index) => index ? image : { ...image, remoteReference: historicalGhcrImages[0].remoteReference }),
      currentGhcrImages.map((image, index) => index ? image : { ...image, remoteDigest: historicalGhcrImages[0].remoteDigest }),
      currentGhcrImages.map((image, index) => index ? image : { ...image, remoteReference: image.remoteReference.replace("orivra-caddy", "other") }),
    ]) expect(() => module.ProductionPilotPreflightEvidenceV1Schema.parse({
      ...currentEvidence,
      checks: currentEvidence.checks.map((value) => value.check === "read-only-ghcr" ? { ...value, images: invalid } : value),
    })).toThrow();
  });

  it("serializes one exact V2 deployment envelope without staging authority", async () => {
    const module = await feature();
    const target = {
      version: "2", kind: "digitalocean-production-target", provider: "digitalocean", environment: "production",
      deploymentMode: "direct-pilot", deploymentId: "orivra-production-primary", composeProject: "proofline-production-primary",
      publicOrigin: "https://orivra.xyz", dnsName: "orivra.xyz",
      sshEndpoint: { host: "72.56.81.28", port: 22, hostKeySha256: sha("1") }, ingress: [80, 443], objectStore: timewebAuthority,
    };
    const images = repositories.map(([id, remoteRepository], index) => {
      const remoteDigest = sha(String.fromCharCode(97 + index));
      return { id, remoteRepository, remoteReference: `${remoteRepository}@${remoteDigest}`, remoteDigest };
    });
    const deployment = {
      version: "2", kind: "digitalocean-production-deployment-evidence", status: "passed", verification: "verified", productionClaim: true,
      producer: { commitSha: "1".repeat(40), treeSha: "2".repeat(40) }, publicationEvidenceSha256: sha("3"), frozenReleaseManifestSha256: sha("4"),
      promotionAuthorizationSha256: sha("5"), preflightEvidenceSha256: sha("6"), target,
      run: { runId: "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4", operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4", completedAt: "2026-08-12T03:00:01Z" },
      pullCredential: { registry: "ghcr.io", access: "read-only" }, images,
      topology: { publicService: "caddy", publicPorts: [80, 443], privateServices: ["web", "api", "worker", "postgres"], forbiddenPublicPorts: [5432, 8080], dockerSocketMounted: false },
      database: { migrationManifestSha256: sha("7"), targetVersion: 10, schemaVersion: 10, roleBootstrap: { status: "passed" }, migration: { status: "passed" } },
      objectStore: timewebAuthority, safeConsumers,
      checks: {
        exactDigestPull: { status: "passed" }, readyz: { status: "passed" }, workerHeartbeat: { status: "current" },
        timewebPitr: { status: "passed", restoreEvidenceSha256: sha("8"), backupAgeSeconds: 60, archivePendingAgeSeconds: 30 },
        liveCoston2: { status: "persisted", runIds: ["run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", "run_01K2Q4P6R8T0V2X4Z6B8D0F2H5"], manifests: [OPEN_METEO_RELAYER, ETH_USD_RELAYER] },
      },
      cutover: { status: "passed", publicOrigin: "https://orivra.xyz", activatedAt: "2026-08-12T03:00:00Z", browserAcceptanceSha256: sha("9") },
    };
    expect(module.ProductionDeploymentEvidenceV2Schema.parse(deployment)).toEqual(deployment);
    expect(module.canonicalSerializeProductionDeploymentEvidenceV2(deployment)).toBe(canonicalJson(deployment));
    expect(module.checksumProductionDeploymentEvidenceV2(deployment)).toBe(checksum(deployment));
    expect(module.canonicalSerializeProductionDeploymentEvidenceV2(deployment)).toContain(sha("9"));
    expect(() => module.ProductionDeploymentEvidenceV2Schema.parse({ ...deployment, cutover: { status: "passed", publicOrigin: "https://orivra.xyz", activatedAt: "2026-08-12T03:00:00Z" } })).toThrow();
    expect(() => module.ProductionDeploymentEvidenceV2Schema.parse({ ...deployment, cutover: { ...deployment.cutover, browserAcceptanceSha256: "sha256:bad" } })).toThrow();
  });

  it("retains rollback V1 as data but requires a separately canonical V2 authority for V2 effect", async () => {
    const module = await feature();
    const authorization = {
      version: "2", kind: "application-rollback-authorization", status: "authorized", rollback: true,
      currentProductionDeploymentEvidenceSha256: sha("1"), priorProductionDeploymentEvidenceSha256: sha("2"),
      currentPublicationEvidenceSha256: sha("3"), priorPublicationEvidenceSha256: sha("4"),
      currentSchemaVersion: 10, priorMinimumCompatibleVersion: 10, priorMaximumCompatibleVersion: 10,
      operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4", authorizedAt: "2026-08-12T03:00:00Z", expiresAt: "2026-08-12T03:30:00Z",
    };
    expect(module.ApplicationRollbackAuthorizationV2Schema.parse(authorization)).toEqual(authorization);
    expect(module.canonicalSerializeApplicationRollbackAuthorizationV2(authorization)).toBe(canonicalJson(authorization));
    expect(module.checksumApplicationRollbackAuthorizationV2(authorization)).toBe(checksum(authorization));
    expect(() => module.ApplicationRollbackAuthorizationV2Schema.parse({ ...authorization, currentPublicationEvidenceSha256: undefined })).toThrow();
    expect(() => module.ApplicationRollbackAuthorizationV2Schema.parse({ ...authorization, version: "1" })).toThrow();
    expect(() => module.ApplicationRollbackAuthorizationV2Schema.parse({ ...authorization, priorMinimumCompatibleVersion: 11 })).toThrow();
    expect(() => module.ApplicationRollbackAuthorizationV2Schema.parse({ ...authorization, priorMaximumCompatibleVersion: 9 })).toThrow();
    expect(() => module.ApplicationRollbackAuthorizationV2Schema.parse({ ...authorization, expiresAt: authorization.authorizedAt })).toThrow();
  });

  it("accepts terminal V2 promotion only from the exact resumable 0/15m/1h/24h trusted-clock sequence", async () => {
    const module = await feature();
    const checks = {
      healthz: { status: "passed" }, readyz: { status: "passed" }, workerHeartbeat: { status: "current" },
      objectStore: { status: "passed", backupAgeSeconds: 60, archivePendingAgeSeconds: 30 },
      diskPressure: { status: "passed" }, hostedBrowserSmoke: { status: "passed" },
      liveCoston2: { status: "persisted", runIds: ["run_01K2Q4P6R8T0V2X4Z6B8D0F2H4", "run_01K2Q4P6R8T0V2X4Z6B8D0F2H5"] },
      clock: clockCheck,
    };
    const checkpoints = [
      ["cutover", "2026-08-12T03:00:00Z", "2026-08-12T03:00:01Z"],
      ["post-cutover-15m", "2026-08-12T03:15:00Z"],
      ["post-cutover-1h", "2026-08-12T04:00:00Z"],
      ["post-cutover-24h", "2026-08-13T03:00:00Z"],
    ].map(([id, dueAt, observedAt = dueAt]) => ({ version: "2", kind: "production-canary-checkpoint", id, dueAt, observedAt, status: "passed", checks }));
    for (const checkpoint of checkpoints) {
      expect(module.ProductionCanaryCheckpointV2Schema.parse(checkpoint)).toEqual(checkpoint);
      expect(module.canonicalSerializeProductionCanaryCheckpointV2(checkpoint)).toBe(canonicalJson(checkpoint));
      expect(module.checksumProductionCanaryCheckpointV2(checkpoint)).toBe(checksum(checkpoint));
    }
    for (const invalid of [
      { ...checkpoints[1], checks: { ...checks, clock: undefined } },
      { ...checkpoints[1], checks: { ...checks, clock: { ...clockCheck, authority: "caller" } } },
      { ...checkpoints[1], checks: { ...checks, clock: { ...clockCheck, source: "caller" } } },
      { ...checkpoints[1], checks: { ...checks, clock: { ...clockCheck, observedSkewSeconds: 6 } } },
    ]) expect(() => module.ProductionCanaryCheckpointV2Schema.parse(invalid)).toThrow();
    const evidence = {
      version: "2", kind: "digitalocean-production-promotion-evidence", status: "passed", verification: "verified", promotionClaim: true,
      producer: { commitSha: "1".repeat(40), treeSha: "2".repeat(40) }, publicationEvidenceSha256: sha("3"),
      productionDeploymentEvidenceSha256: sha("4"), runId: "prod_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
      operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4", cutover: { status: "passed", publicOrigin: "https://orivra.xyz", activatedAt: checkpoints[0].dueAt, browserAcceptanceSha256: sha("9") },
      canary: { durationSeconds: 86400, checkpoints }, completedAt: checkpoints.at(-1)?.observedAt,
    };
    expect(module.ProductionPromotionEvidenceV2Schema.parse(evidence)).toEqual(evidence);
    expect(module.canonicalSerializeProductionPromotionEvidenceV2(evidence)).toBe(canonicalJson(evidence));
    expect(module.checksumProductionPromotionEvidenceV2(evidence)).toBe(checksum(evidence));
    expect(() => module.ProductionPromotionEvidenceV2Schema.parse({ ...evidence, completedAt: "2026-08-12T04:00:00Z" })).toThrow();
    expect(() => module.ProductionPromotionEvidenceV2Schema.parse({ ...evidence, completedAt: "2026-08-13T03:00:01Z" })).toThrow();
    expect(() => module.ProductionPromotionEvidenceV2Schema.parse({ ...evidence, cutover: { ...evidence.cutover, activatedAt: "2026-08-12T02:59:59Z" } })).toThrow();
    expect(() => module.ProductionPromotionEvidenceV2Schema.parse({ ...evidence, canary: { ...evidence.canary, checkpoints: checkpoints.map((entry, index) => index === 2 ? { ...entry, dueAt: "2026-08-12T04:00:01Z" } : entry) } })).toThrow();
    expect(() => module.ProductionPromotionEvidenceV2Schema.parse({ ...evidence, canary: { ...evidence.canary, durationSeconds: 3600, checkpoints: checkpoints.slice(0, 3) } })).toThrow();
  });
});
