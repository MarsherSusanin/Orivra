import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  StagingDeploymentEvidenceV1Schema,
  canonicalSerializeStagingDeploymentEvidence,
} from "../../packages/contracts/src/publication-runtime.mjs";
import { createPublicationHandoffFixture } from "../fixtures/slice028b-publication-handoff.fixture.mjs";

const sha = (value) => `sha256:${value.repeat(64).slice(0, 64)}`;
const imageIds = ["caddy", "web", "api", "worker", "postgres-recovery"];
const stagingCommandIds = [
  "install-read-only-pull-credential", "pull-exact-digests", "inspect-local-digests",
  "start-postgres", "role-bootstrap", "migrator", "start-api", "start-worker",
  "start-web", "start-caddy", "healthz", "readyz-real-heartbeat",
  "hosted-browser-smoke", "spaces-pitr-restore", "persisted-live-coston2",
];
const imageEnvironment = {
  caddy: "PROOFLINE_CADDY_IMAGE",
  web: "PROOFLINE_WEB_IMAGE",
  api: "PROOFLINE_API_IMAGE",
  worker: "PROOFLINE_WORKER_IMAGE",
  "postgres-recovery": "PROOFLINE_POSTGRES_IMAGE",
};

async function runtime() {
  return import("../../scripts/digitalocean-staging-runtime.mjs").catch(() => ({}));
}

function publicationEvidence() {
  return createPublicationHandoffFixture().evidence;
}

function stagingTarget() {
  return {
    origin: "https://staging.example.test",
    composeProject: "proofline-staging-01k2q4p6r8t0v2x4z6b8d0f2h4",
    sshHostKeySha256: sha("8"),
  };
}

function stagingRun() {
  return {
    runId: "stg_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    operatorId: "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H4",
    completedAt: "2026-08-12T00:10:00Z",
  };
}

function typedObservation(command, evidence) {
  const common = { status: "passed", sshHostKeySha256: sha("8") };
  if (command.id === "inspect-local-digests") {
    return { ...common, images: evidence.images.map(({ id, remoteDigest }) => ({ id, remoteDigest })) };
  }
  if (command.id === "migrator") {
    return { ...common, migrationManifestSha256: sha("6"), targetVersion: 10, schemaVersion: 10 };
  }
  if (command.id === "readyz-real-heartbeat") {
    return { ...common, readyz: { status: "passed" }, workerHeartbeat: { status: "current" } };
  }
  if (command.id === "spaces-pitr-restore") {
    return { ...common, restoreEvidenceSha256: sha("7") };
  }
  if (command.id === "persisted-live-coston2") {
    return { ...common, runId: "run_01K2Q4P6R8T0V2X4Z6B8D0F2H4" };
  }
  if (command.id === "install-read-only-pull-credential") {
    return { ...common, registry: "ghcr.io", access: "read-only" };
  }
  return common;
}

function legacyObservation(command, evidence) {
  if (command.id === "inspect-local-digests") {
    return evidence.images.map(({ id, remoteDigest }) => ({ id, remoteDigest }));
  }
  return typedObservation(command, evidence);
}

test("028B staging accepts only separate file-backed least-authority credentials", async () => {
  const module = await runtime();
  const parent = await mkdtemp(join(tmpdir(), "proofline-028b-staging-auth-"));
  const files = {
    doApiTokenFile: join(parent, "do-api-token"),
    ghcrPullTokenFile: join(parent, "ghcr-pull-token"),
    sshPrivateKeyFile: join(parent, "ssh-private-key"),
  };
  const stagingSecretRoot = join(parent, "staging-secrets");
  try {
    await Promise.all(Object.values(files).map((path) => writeFile(path, "secret-sentinel", { mode: 0o400 })));
    await mkdir(stagingSecretRoot, { mode: 0o500 });
    const environment = await module.createStagingCredentialEnvironment({
      ambientEnvironment: {
        PATH: "/usr/bin:/bin",
        HOME: "/Users/example",
        GHCR_TOKEN: "ambient-write-token",
        DIGITALOCEAN_ACCESS_TOKEN: "ambient-do-token",
        SSH_AUTH_SOCK: "/tmp/agent",
        PROOFLINE_COSTON2_PRIVATE_KEY: "ambient-private-key",
      },
      username: "staging-pull",
      stagingSecretRoot,
      inspectSecretFile: lstat,
      ...files,
    });
    assert.deepEqual(environment, {
      PATH: "/usr/bin:/bin",
      PROOFLINE_DO_API_TOKEN_FILE: files.doApiTokenFile,
      PROOFLINE_GHCR_PULL_USERNAME: "staging-pull",
      PROOFLINE_GHCR_PULL_TOKEN_FILE: files.ghcrPullTokenFile,
      PROOFLINE_STAGING_SECRET_ROOT: stagingSecretRoot,
      PROOFLINE_STAGING_SSH_PRIVATE_KEY_FILE: files.sshPrivateKeyFile,
    });
    assert.doesNotMatch(JSON.stringify(environment), /secret-sentinel|ambient|SSH_AUTH_SOCK/);
  } finally {
    await Promise.all(Object.values(files).map((path) => chmod(path, 0o600).catch(() => undefined)));
    await chmod(stagingSecretRoot, 0o700).catch(() => undefined);
    await rm(parent, { recursive: true, force: true });
  }
});

test("028B maps only publication-authorized digests into the staging Compose environment", async () => {
  const module = await runtime();
  const publicationHandoff = createPublicationHandoffFixture();
  const evidence = publicationHandoff.evidence;
  const plan = module.createStagingImagePlan({
    publicationHandoff,
    publicationEvidence: evidence,
    publicationEvidenceSha256: publicationHandoff.expectedPublicationEvidenceSha256,
  });
  assert.deepEqual(Object.keys(plan.environment).sort(), Object.values(imageEnvironment).sort());
  for (const image of evidence.images) {
    assert.equal(plan.environment[imageEnvironment[image.id]], image.remoteReference);
    assert.match(plan.environment[imageEnvironment[image.id]], /@sha256:[a-f0-9]{64}$/);
  }
  assert.equal(plan.pullPolicy, "explicit-before-compose");
  assert.equal(plan.credentialAccess, "read-only");
  assert.doesNotMatch(JSON.stringify(plan), /:latest|build|push|production/i);
});

test("028B staging runs exact pulls, migrations, readiness, browser, PITR and live checks", async () => {
  const module = await runtime();
  const publicationHandoff = createPublicationHandoffFixture();
  const evidence = publicationHandoff.evidence;
  const order = [];
  const sshCommands = [];
  let evidenceWrites = 0;
  let emittedEvidence;
  const result = await module.runDigitalOceanStaging({
    publicationHandoff,
    publicationEvidence: evidence,
    publicationEvidenceSha256: publicationHandoff.expectedPublicationEvidenceSha256,
    target: stagingTarget(),
    run: stagingRun(),
    digitalOceanAdapter: {
      provision: async () => { order.push("provision"); return { deploymentId: "do-staging-1", sshHost: "203.0.113.10", owned: true }; },
      applyFirewall: async () => order.push("firewall"),
    },
    sshAdapter: {
      run: async (command) => {
        sshCommands.push(command);
        order.push(command.id);
        return legacyObservation(command, evidence);
      },
      openPinnedSession: async ({ endpoint, expectedHostKeySha256 }) => {
        order.push("open-pinned-ssh");
        assert.deepEqual(endpoint, { host: "203.0.113.10", port: 22 });
        assert.equal(expectedHostKeySha256, sha("8"));
        return {
          observedHostKeySha256: sha("8"),
          run: async (command) => {
            sshCommands.push(command);
            order.push(command.id);
            return typedObservation(command, evidence);
          },
          close: async () => order.push("close-pinned-ssh"),
        };
      },
    },
    appendStagingEvidence: async ({ filename, bytes }) => {
      evidenceWrites += 1;
      assert.equal(filename, "staging-deployment-evidence.v1.json");
      emittedEvidence = StagingDeploymentEvidenceV1Schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
      assert.equal(new TextDecoder().decode(bytes), canonicalSerializeStagingDeploymentEvidence(emittedEvidence));
    },
    cleanup: async () => order.push("cleanup"),
  });
  assert.deepEqual(order, [
    "provision", "firewall", "open-pinned-ssh", "install-read-only-pull-credential",
    "pull-exact-digests", "inspect-local-digests", "start-postgres",
    "role-bootstrap", "migrator", "start-api", "start-worker", "start-web",
    "start-caddy", "healthz", "readyz-real-heartbeat", "hosted-browser-smoke",
    "spaces-pitr-restore", "persisted-live-coston2", "close-pinned-ssh", "cleanup",
  ]);
  assert.equal(evidenceWrites, 1);
  assert.equal(result.status, "passed");
  assert.equal(result.environment, "staging");
  assert.equal(emittedEvidence.producer.commitSha, evidence.producer.commitSha);
  assert.equal(emittedEvidence.frozenReleaseManifestSha256, evidence.frozenRelease.frozenReleaseManifestSha256);
  assert.equal(emittedEvidence.publicationEvidenceSha256, publicationHandoff.expectedPublicationEvidenceSha256);
  assert.equal(emittedEvidence.run.sshHostKeySha256, sha("8"));
  assert.deepEqual(emittedEvidence.pullCredential, { registry: "ghcr.io", access: "read-only" });
  assert.deepEqual(emittedEvidence.images, evidence.images.map(({ id, remoteRepository, remoteReference, remoteDigest }) => ({
    id, remoteRepository, remoteReference, remoteDigest,
  })));
  assert.equal(sshCommands.every((command) =>
    !JSON.stringify(command).match(/token|password|privateKey|:latest|docker build|pg_promote/i)), true);
});

test("028B staging failure retains publication evidence and cleans only run-owned staging", async () => {
  const module = await runtime();
  const publicationHandoff = createPublicationHandoffFixture();
  const evidence = publicationHandoff.evidence;
  const cleaned = [];
  let localCloses = 0;
  let stagingEvidenceWrites = 0;
  let productionCalls = 0;
  const cause = await module.runDigitalOceanStaging({
    publicationHandoff,
    publicationEvidence: evidence,
    publicationEvidenceSha256: publicationHandoff.expectedPublicationEvidenceSha256,
    run: stagingRun(),
    target: {
      origin: "https://staging.example.test",
      composeProject: "proofline-staging-failure",
      sshHostKeySha256: sha("8"),
    },
    digitalOceanAdapter: {
      provision: async () => ({ deploymentId: "do-staging-failure", sshHost: "203.0.113.10", owned: true }),
      applyFirewall: async () => undefined,
      production: async () => { productionCalls += 1; },
    },
    sshAdapter: {
      run: async (command) => {
        if (command.id === "readyz-real-heartbeat") throw new Error("staging-not-ready");
        return legacyObservation(command, evidence);
      },
      openPinnedSession: async () => ({
        observedHostKeySha256: sha("8"),
        run: async (command) => {
          if (command.id === "readyz-real-heartbeat") throw new Error("staging-not-ready");
          return typedObservation(command, evidence);
        },
        close: async () => undefined,
      }),
    },
    appendStagingEvidence: async () => { stagingEvidenceWrites += 1; },
    closeLocalSession: async () => { localCloses += 1; },
    teardownStaging: async (resource) => cleaned.push(resource),
    cleanup: async (resource) => cleaned.push(resource),
  }).catch((error) => error);
  assert.equal(cause.code, "DIGITALOCEAN_STAGING_FAILED");
  assert.equal(cause.partial.publicationEvidenceRetained, true);
  assert.equal(cause.partial.stagingEvidenceWritten, false);
  assert.deepEqual(cleaned, [{ deploymentId: "do-staging-failure", sshHost: "203.0.113.10", owned: true }]);
  assert.equal(localCloses >= 1, true);
  assert.equal(stagingEvidenceWrites, 0);
  assert.equal(productionCalls, 0);
  assert.doesNotMatch(JSON.stringify(cause), /secret|token|private|password/i);
});

test("028B rejects a forged canonical five-reference handoff before DigitalOcean or SSH", async () => {
  const module = await runtime();
  const valid = createPublicationHandoffFixture();
  const forgedEvidence = {
    ...valid.evidence,
    images: valid.evidence.images.map((image, index) => {
      const remoteRepository = `ghcr.io/evil-owner/forged-${image.id}`;
      const remoteDigest = sha(String(index + 1));
      return { ...image, remoteRepository, remoteDigest, imageManifestDigest: remoteDigest, remoteReference: `${remoteRepository}@${remoteDigest}` };
    }),
  };
  const forgedBytes = new TextEncoder().encode(JSON.stringify(forgedEvidence));
  let effects = 0;
  await assert.rejects(() => module.runDigitalOceanStaging({
    publicationEvidence: forgedEvidence,
    publicationHandoff: {
      ...valid,
      evidence: forgedEvidence,
      evidenceBytes: forgedBytes,
      expectedPublicationEvidenceSha256: sha("0"),
    },
    publicationEvidenceSha256: sha("0"),
    target: stagingTarget(),
    run: stagingRun(),
    digitalOceanAdapter: { provision: async () => { effects += 1; } },
    sshAdapter: { openPinnedSession: async () => { effects += 1; } },
    appendStagingEvidence: async () => { effects += 1; },
    cleanup: async () => undefined,
  }));
  assert.equal(effects, 0);
});

test("028B keeps async staging authority bound to a private value parsed from canonical bytes", async () => {
  const module = await runtime();
  const canonical = createPublicationHandoffFixture();
  const mutableEvidence = JSON.parse(new TextDecoder().decode(canonical.evidenceBytes));
  const publicationHandoff = { ...canonical, evidence: mutableEvidence };
  const canonicalImage = canonical.evidence.images[0];
  const evilRepository = "ghcr.io/evil-owner/orivra-caddy";
  const evilReference = `${evilRepository}@${canonicalImage.remoteDigest}`;
  const imageCommands = [];
  let evidenceWrites = 0;
  let emittedEvidence;

  const outcome = await module.runDigitalOceanStaging({
    publicationHandoff,
    publicationEvidence: mutableEvidence,
    publicationEvidenceSha256: canonical.expectedPublicationEvidenceSha256,
    target: stagingTarget(),
    run: stagingRun(),
    digitalOceanAdapter: {
      provision: async () => {
        await Promise.resolve();
        mutableEvidence.images[0].remoteRepository = evilRepository;
        mutableEvidence.images[0].remoteReference = evilReference;
        return { deploymentId: "do-staging-authority", sshHost: "203.0.113.10", owned: true };
      },
      applyFirewall: async () => undefined,
    },
    sshAdapter: {
      openPinnedSession: async () => ({
        observedHostKeySha256: sha("8"),
        run: async (command) => {
          if (command.id === "pull-exact-digests" || command.id === "inspect-local-digests") {
            imageCommands.push(structuredClone(command));
          }
          return typedObservation(command, canonical.evidence);
        },
        close: async () => undefined,
      }),
    },
    appendStagingEvidence: async ({ bytes }) => {
      evidenceWrites += 1;
      emittedEvidence = StagingDeploymentEvidenceV1Schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    },
    closeLocalSession: async () => undefined,
    teardownStaging: async () => undefined,
  }).catch((error) => error);

  if (outcome instanceof Error) {
    assert.equal(imageCommands.length, 0);
    assert.equal(evidenceWrites, 0);
  } else {
    assert.equal(outcome.status, "passed");
    assert.equal(evidenceWrites, 1);
    assert.equal(emittedEvidence.images[0].remoteRepository, canonicalImage.remoteRepository);
    assert.equal(emittedEvidence.images[0].remoteReference, canonicalImage.remoteReference);
    assert.equal(imageCommands.length, 2);
    for (const command of imageCommands) {
      assert.equal(command.imageReferences[0].remoteReference, canonicalImage.remoteReference);
    }
  }
  assert.doesNotMatch(JSON.stringify({ imageCommands, emittedEvidence }), /evil-owner/);
});

test("028B snapshots staging target and run before the first async effect", async () => {
  const module = await runtime();
  const publicationHandoff = createPublicationHandoffFixture();
  const target = stagingTarget();
  const run = stagingRun();
  const expectedTarget = structuredClone(target);
  const expectedRun = structuredClone(run);
  let releaseProvision;
  let provisionStarted;
  const provisionStartedPromise = new Promise((resolve) => { provisionStarted = resolve; });
  const provisionReleasePromise = new Promise((resolve) => { releaseProvision = resolve; });
  let provisionTarget;
  const sessionPins = [];
  const commands = [];
  let emittedEvidence;

  const invocation = module.runDigitalOceanStaging({
    publicationHandoff,
    publicationEvidence: publicationHandoff.evidence,
    publicationEvidenceSha256: publicationHandoff.expectedPublicationEvidenceSha256,
    target,
    run,
    digitalOceanAdapter: {
      provision: async ({ target: adapterTarget }) => {
        provisionStarted();
        await provisionReleasePromise;
        provisionTarget = structuredClone(adapterTarget);
        return { deploymentId: "do-staging-snapshot", sshHost: "203.0.113.10", owned: true };
      },
      applyFirewall: async () => undefined,
    },
    sshAdapter: {
      openPinnedSession: async ({ expectedHostKeySha256 }) => {
        sessionPins.push(expectedHostKeySha256);
        return {
          observedHostKeySha256: expectedHostKeySha256,
          run: async (command) => {
            commands.push(structuredClone(command));
            return {
              ...typedObservation(command, publicationHandoff.evidence),
              sshHostKeySha256: expectedHostKeySha256,
            };
          },
          close: async () => undefined,
        };
      },
    },
    appendStagingEvidence: async ({ bytes }) => {
      emittedEvidence = StagingDeploymentEvidenceV1Schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    },
    closeLocalSession: async () => undefined,
    teardownStaging: async () => undefined,
  });

  await provisionStartedPromise;
  Reflect.set(target, "origin", "https://production.example.test");
  Reflect.set(target, "composeProject", "proofline-production-live");
  Reflect.set(target, "sshHostKeySha256", sha("9"));
  Reflect.set(run, "runId", "stg_01K2Q4P6R8T0V2X4Z6B8D0F2H5");
  Reflect.set(run, "operatorId", "operator_01K2Q4P6R8T0V2X4Z6B8D0F2H5");
  Reflect.set(run, "completedAt", "2026-08-12T23:59:59Z");
  releaseProvision();

  const result = await invocation.catch((error) => error);
  assert.deepEqual(provisionTarget, expectedTarget);
  if (result instanceof Error) {
    assert.equal(sessionPins.length, 0);
    assert.equal(commands.length, 0);
    assert.equal(emittedEvidence, undefined);
    return;
  }
  assert.equal(result.status, "passed");
  assert.deepEqual(sessionPins, [expectedTarget.sshHostKeySha256]);
  assert.equal(commands.length, stagingCommandIds.length);
  assert.equal(commands.every((command) => command.composeProject === expectedTarget.composeProject), true);
  assert.equal(emittedEvidence.target.composeProject, expectedTarget.composeProject);
  assert.equal(emittedEvidence.target.publicOrigin, expectedTarget.origin);
  assert.equal(emittedEvidence.run.sshHostKeySha256, expectedTarget.sshHostKeySha256);
  assert.equal(emittedEvidence.run.runId, expectedRun.runId);
  assert.equal(emittedEvidence.run.operatorId, expectedRun.operatorId);
  assert.equal(emittedEvidence.run.completedAt, expectedRun.completedAt);
  assert.doesNotMatch(JSON.stringify({ provisionTarget, sessionPins, commands, emittedEvidence }), /production-live|production\.example|F2H5|sha256:9{64}/);
});

test("028B rejects failed or ambiguous typed observations before PASS evidence", async () => {
  const module = await runtime();
  for (const failedCommandId of stagingCommandIds) {
    for (const invalidObservation of [{ status: "failed" }, { status: "passed", extra: true }]) {
    const publicationHandoff = createPublicationHandoffFixture();
    let evidenceWrites = 0;
    await assert.rejects(() => module.runDigitalOceanStaging({
      publicationHandoff,
      publicationEvidence: publicationHandoff.evidence,
      publicationEvidenceSha256: publicationHandoff.expectedPublicationEvidenceSha256,
      target: stagingTarget(),
      run: stagingRun(),
      digitalOceanAdapter: {
        provision: async () => ({ deploymentId: "do-staging-observation", sshHost: "203.0.113.10", owned: true }),
        applyFirewall: async () => undefined,
      },
      sshAdapter: {
        run: async (command) => command.id === failedCommandId
          ? invalidObservation
          : legacyObservation(command, publicationHandoff.evidence),
        openPinnedSession: async () => ({
          observedHostKeySha256: sha("8"),
          run: async (command) => command.id === failedCommandId
            ? invalidObservation
            : typedObservation(command, publicationHandoff.evidence),
          close: async () => undefined,
        }),
      },
      appendStagingEvidence: async () => { evidenceWrites += 1; },
      cleanup: async () => undefined,
    }));
    assert.equal(evidenceWrites, 0);
    }
  }
});

test("028B rejects an SSH host-key mismatch before the first remote command", async () => {
  const module = await runtime();
  const publicationHandoff = createPublicationHandoffFixture();
  let pinnedSessionCalls = 0;
  let remoteCommands = 0;
  let evidenceWrites = 0;
  await assert.rejects(() => module.runDigitalOceanStaging({
    publicationHandoff,
    publicationEvidence: publicationHandoff.evidence,
    publicationEvidenceSha256: publicationHandoff.expectedPublicationEvidenceSha256,
    target: stagingTarget(),
    run: stagingRun(),
    digitalOceanAdapter: {
      provision: async () => ({ deploymentId: "do-staging-host-key", sshHost: "203.0.113.10", owned: true }),
      applyFirewall: async () => undefined,
    },
    sshAdapter: {
      run: async (command) => {
        remoteCommands += 1;
        return legacyObservation(command, publicationHandoff.evidence);
      },
      openPinnedSession: async ({ endpoint, expectedHostKeySha256 }) => {
        pinnedSessionCalls += 1;
        assert.deepEqual(endpoint, { host: "203.0.113.10", port: 22 });
        assert.equal(expectedHostKeySha256, sha("8"));
        return {
          observedHostKeySha256: sha("9"),
          run: async () => { remoteCommands += 1; },
          close: async () => undefined,
        };
      },
    },
    appendStagingEvidence: async () => { evidenceWrites += 1; },
    cleanup: async () => undefined,
  }));
  assert.equal(pinnedSessionCalls, 1);
  assert.equal(remoteCommands, 0);
  assert.equal(evidenceWrites, 0);
});

test("028B closes local sessions but preserves successful staging infrastructure", async () => {
  const module = await runtime();
  const publicationHandoff = createPublicationHandoffFixture();
  let localCloses = 0;
  let stagingTeardowns = 0;
  const result = await module.runDigitalOceanStaging({
    publicationHandoff,
    publicationEvidence: publicationHandoff.evidence,
    publicationEvidenceSha256: publicationHandoff.expectedPublicationEvidenceSha256,
    target: stagingTarget(),
    run: stagingRun(),
    digitalOceanAdapter: {
      provision: async () => ({ deploymentId: "do-staging-persist", sshHost: "203.0.113.10", owned: true }),
      applyFirewall: async () => undefined,
    },
    sshAdapter: {
      run: async (command) => legacyObservation(command, publicationHandoff.evidence),
      openPinnedSession: async () => ({
        observedHostKeySha256: sha("8"),
        run: async (command) => typedObservation(command, publicationHandoff.evidence),
        close: async () => { localCloses += 1; },
      }),
    },
    appendStagingEvidence: async () => undefined,
    closeLocalSession: async () => { localCloses += 1; },
    teardownStaging: async () => { stagingTeardowns += 1; },
    cleanup: async () => { stagingTeardowns += 1; },
  });
  assert.equal(result.status, "passed");
  assert.equal(localCloses >= 1, true);
  assert.equal(stagingTeardowns, 0);
});

test("028B code boundary excludes production promotion and canary", async () => {
  const [publicationSource, stagingSource] = await Promise.all([
    readFile(new URL("../../scripts/ghcr-publication-runtime.mjs", import.meta.url), "utf8").catch(() => ""),
    readFile(new URL("../../scripts/digitalocean-staging-runtime.mjs", import.meta.url), "utf8").catch(() => ""),
  ]);
  assert.match(publicationSource, /imageManifestDigest/);
  assert.match(stagingSource, /environment["',:\s]+staging/i);
  assert.doesNotMatch(`${publicationSource}\n${stagingSource}`, /production promotion|canary|pg_promote/i);
});
