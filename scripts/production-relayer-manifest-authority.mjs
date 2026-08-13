export const PRODUCTION_RELAYER_MANIFESTS = Object.freeze([
  Object.freeze(["open-meteo-current-weather", "sha256:1fb914f985c85333292f1d4a278010ff7e94d3459b95974f8d47eb70d0f7cfe6"]),
  Object.freeze(["eth-usd", "sha256:eaed1554eb215de798f3acc0a3936b469529595e563630e7cb1ae5defbd57f9f"]),
]);
const REPLAY = Object.freeze([
  "sha256:26a1b91f8fc63056f2d464b81b1ee452dfd30bd01cd4433ee5e33410c651c898",
  "sha256:7aed4a243cb1cdc23a4faf2cbd687c3effb97805cb4f0ca44a666b385cd2b2db",
]);

function invalid(cause) {
  throw Object.assign(new Error("PRODUCTION_RELAYER_MANIFEST_INVALID: Production relayer manifest authority is invalid"), {
    code: "PRODUCTION_RELAYER_MANIFEST_INVALID",
    cause,
  });
}

export async function resolveProductionLiveManifestAuthorities(input = {}) {
  try {
    if (!Array.isArray(input.authorities) || input.authorities.length !== 2 ||
      JSON.stringify(input.expectedReplayManifestSha256s) !== JSON.stringify(REPLAY) ||
      typeof input.resolveAlias !== "function") invalid();
    const resolved = [];
    for (let index = 0; index < PRODUCTION_RELAYER_MANIFESTS.length; index += 1) {
      const [expectedId, expectedLive] = PRODUCTION_RELAYER_MANIFESTS[index];
      const authority = input.authorities[index];
      if (authority?.id !== expectedId || authority.manifestSha256 !== expectedLive || authority.manifest?.submission?.mode !== "relayer") invalid();
      const alias = await input.resolveAlias({
        relayerManifest: authority.manifest,
        relayerManifestSha256: expectedLive,
        replayManifestSha256: REPLAY[index],
      });
      if (alias?.sourceLiveManifestSha256 !== expectedLive || alias.replayManifestSha256 !== REPLAY[index]) invalid();
      resolved.push(Object.freeze({ ...alias }));
    }
    return Object.freeze(resolved);
  } catch (cause) {
    if (cause?.code === "PRODUCTION_RELAYER_MANIFEST_INVALID") throw cause;
    invalid(cause);
  }
}

export async function runProductionRelayerManifestGate(input) {
  try {
    if (JSON.stringify(input.registryManifestSha256s) !== JSON.stringify(REPLAY) ||
      JSON.stringify(input.liveManifestSha256s) !== JSON.stringify(PRODUCTION_RELAYER_MANIFESTS.map(([, sha]) => sha)) ||
      JSON.stringify(input.aliases) !== JSON.stringify(PRODUCTION_RELAYER_MANIFESTS.map(([, sha], index) => [sha, REPLAY[index]]))) invalid();
    const effects = [];
    for (let index = 0; index < PRODUCTION_RELAYER_MANIFESTS.length; index += 1) {
      const liveSha = PRODUCTION_RELAYER_MANIFESTS[index][1];
      const loadedLive = await input.loadManifest(liveSha);
      const loadedReplay = await input.loadManifest(REPLAY[index]);
      if (loadedLive?.manifestSha256 !== liveSha || loadedLive?.submission?.mode !== "relayer" ||
        loadedReplay?.manifestSha256 !== REPLAY[index] || loadedReplay?.submission?.mode !== "replay") invalid();
      const result = await input.rpc(liveSha);
      if (result?.status !== "passed") invalid();
      effects.push(result);
    }
    return Object.freeze({ status: "passed", effects: Object.freeze(effects) });
  } catch (cause) {
    if (cause?.code === "PRODUCTION_RELAYER_MANIFEST_INVALID") throw cause;
    invalid(cause);
  }
}
