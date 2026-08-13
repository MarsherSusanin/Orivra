import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OPEN_REPLAY = "sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898";
const ETH_REPLAY = "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db";
const OPEN_RELAYER = "sha256:1fb914f985c85333292f1d4a278010ff7e94d3459b95974f8d47eb70d0f7cfe6";
const ETH_RELAYER = "sha256:eaed1554eb215de798f3acc0a3936b469529595e563630e7cb1ae5defbd57f9f";

test("binds replay-keyed safe consumers to two live relayer aliases before RPC", async () => {
  const module = await import("../../scripts/production-relayer-manifest-authority.mjs").catch(() => ({}));
  assert.deepEqual(module.PRODUCTION_RELAYER_MANIFESTS, [
    ["open-meteo-current-weather", OPEN_RELAYER],
    ["eth-usd", ETH_RELAYER],
  ]);
  const effects = [];
  const result = await module.runProductionRelayerManifestGate({
    registryManifestSha256s: [OPEN_REPLAY, ETH_REPLAY],
    liveManifestSha256s: [OPEN_RELAYER, ETH_RELAYER],
    aliases: [[OPEN_RELAYER, OPEN_REPLAY], [ETH_RELAYER, ETH_REPLAY]],
    loadManifest: async (sha) => ({ manifestSha256: sha, submission: { mode: sha === OPEN_REPLAY || sha === ETH_REPLAY ? "replay" : "relayer" } }),
    rpc: async (sha) => { effects.push(sha); return { status: "passed" }; },
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(effects, [OPEN_RELAYER, ETH_RELAYER]);
  for (const [invalidLive, invalidAliases] of [
    [[OPEN_REPLAY, ETH_RELAYER], [[OPEN_RELAYER, OPEN_REPLAY], [ETH_RELAYER, ETH_REPLAY]]],
    [[OPEN_RELAYER, ETH_REPLAY], [[OPEN_RELAYER, OPEN_REPLAY], [ETH_RELAYER, ETH_REPLAY]]],
    [[OPEN_RELAYER, ETH_RELAYER], [[OPEN_RELAYER, ETH_REPLAY], [ETH_RELAYER, OPEN_REPLAY]]],
  ]) {
    effects.length = 0;
    await assert.rejects(module.runProductionRelayerManifestGate({
      registryManifestSha256s: [OPEN_REPLAY, ETH_REPLAY],
      liveManifestSha256s: invalidLive,
      aliases: invalidAliases,
      loadManifest: async (sha) => ({ manifestSha256: sha, submission: { mode: sha === OPEN_REPLAY || sha === ETH_REPLAY ? "replay" : "relayer" } }),
      rpc: async () => { effects.push("rpc"); },
    }), /PRODUCTION_RELAYER_MANIFEST_INVALID/);
    assert.deepEqual(effects, []);
  }
});

test("production sources keep replay-keyed registry and verify live relayer aliases", async () => {
  const [registry, live, host, bootstrap] = await Promise.all([
    readFile(resolve(root, "scripts/safe-consumer-registry-deployment-runtime.mjs"), "utf8"),
    readFile(resolve(root, "apps/worker/src/production-live-gate-entry.ts"), "utf8"),
    readFile(resolve(root, "scripts/timeweb-production-host-command.mjs"), "utf8"),
    readFile(resolve(root, "apps/worker/src/production-replay-bootstrap-runtime.mjs"), "utf8").catch(() => ""),
  ]);
  assert.match(registry, new RegExp(OPEN_REPLAY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(registry, new RegExp(ETH_REPLAY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const source of [live, host]) {
    assert.match(source, new RegExp(OPEN_RELAYER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(source, new RegExp(ETH_RELAYER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(source, /verifyProductionRelayerReplayAlias/);
  }
  assert.match(bootstrap, new RegExp(OPEN_RELAYER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(bootstrap, new RegExp(OPEN_REPLAY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(bootstrap, /verifyProductionRelayerReplayAlias/);
});

test("resolves both production relayer aliases before the first API or RPC effect", async () => {
  const module = await import("../../scripts/production-relayer-manifest-authority.mjs").catch(() => ({}));
  assert.equal(typeof module.resolveProductionLiveManifestAuthorities, "function");
  const effects = [];
  const aliases = await module.resolveProductionLiveManifestAuthorities({
    authorities: [
      { id: "open-meteo-current-weather", manifestSha256: OPEN_RELAYER, manifest: { submission: { mode: "relayer" } } },
      { id: "eth-usd", manifestSha256: ETH_RELAYER, manifest: { submission: { mode: "relayer" } } },
    ],
    expectedReplayManifestSha256s: [OPEN_REPLAY, ETH_REPLAY],
    resolveAlias: async ({ relayerManifestSha256, replayManifestSha256 }) => {
      effects.push(["alias", relayerManifestSha256, replayManifestSha256]);
      return Object.freeze({ sourceLiveManifestSha256: relayerManifestSha256, replayManifestSha256 });
    },
  });
  assert.deepEqual(effects, [
    ["alias", OPEN_RELAYER, OPEN_REPLAY],
    ["alias", ETH_RELAYER, ETH_REPLAY],
  ]);
  assert.deepEqual(aliases.map(({ sourceLiveManifestSha256, replayManifestSha256 }) => [
    sourceLiveManifestSha256,
    replayManifestSha256,
  ]), [[OPEN_RELAYER, OPEN_REPLAY], [ETH_RELAYER, ETH_REPLAY]]);

  for (const invalidReplay of [ETH_REPLAY, OPEN_RELAYER]) {
    let apiOrRpcEffects = 0;
    await assert.rejects(module.resolveProductionLiveManifestAuthorities({
      authorities: [
        { id: "open-meteo-current-weather", manifestSha256: OPEN_RELAYER, manifest: { submission: { mode: "relayer" } } },
        { id: "eth-usd", manifestSha256: ETH_RELAYER, manifest: { submission: { mode: "relayer" } } },
      ],
      expectedReplayManifestSha256s: [invalidReplay, ETH_REPLAY],
      resolveAlias: async () => { throw new Error("PRODUCTION_RELAYER_MANIFEST_INVALID"); },
      beginLiveEffects: async () => { apiOrRpcEffects += 1; },
    }), /PRODUCTION_RELAYER_MANIFEST_INVALID/);
    assert.equal(apiOrRpcEffects, 0);
  }

  const source = await readFile(resolve(root, "apps/worker/src/production-live-gate-entry.ts"), "utf8");
  assert.match(source, /resolveProductionLiveManifestAuthorities\s*\(/);
  assert.doesNotMatch(source, /^\s*verifyProductionRelayerReplayAlias\s*;\s*$/m);
});
