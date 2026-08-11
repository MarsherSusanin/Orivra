import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const sha = (value) => `sha256:${value.repeat(64).slice(0, 64)}`;
const imageIds = ["caddy", "web", "api", "worker", "postgres-recovery"];
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
  return {
    version: "1",
    kind: "oci-publication-evidence",
    status: "passed",
    verification: "verified",
    publicationClaim: true,
    producer: { commitSha: "a".repeat(40), treeSha: "b".repeat(40) },
    frozenRelease: { frozenReleaseManifestSha256: sha("1") },
    images: imageIds.map((id, index) => {
      const digest = sha(String(index + 1));
      const repository = `ghcr.io/example-owner/orivra-${id}`;
      return {
        id,
        remoteRepository: repository,
        remoteReference: `${repository}@${digest}`,
        remoteDigest: digest,
      };
    }),
  };
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
  const evidence = publicationEvidence();
  const plan = module.createStagingImagePlan({ publicationEvidence: evidence });
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
  const evidence = publicationEvidence();
  const order = [];
  const sshCommands = [];
  let evidenceWrites = 0;
  const result = await module.runDigitalOceanStaging({
    publicationEvidence: evidence,
    publicationEvidenceSha256: sha("9"),
    target: {
      origin: "https://staging.example.test",
      composeProject: "proofline-staging-01k2q4p6r8t0v2x4z6b8d0f2h4",
      sshHostKeySha256: sha("8"),
    },
    digitalOceanAdapter: {
      provision: async () => { order.push("provision"); return { deploymentId: "do-staging-1", owned: true }; },
      applyFirewall: async () => order.push("firewall"),
    },
    sshAdapter: {
      run: async (command) => {
        sshCommands.push(command);
        order.push(command.id);
        return command.id === "inspect-local-digests"
          ? evidence.images.map(({ id, remoteDigest }) => ({ id, remoteDigest }))
          : { status: "passed" };
      },
    },
    appendStagingEvidence: async ({ filename, bytes }) => {
      evidenceWrites += 1;
      assert.equal(filename, "staging-deployment-evidence.v1.json");
      assert.ok(bytes.length > 0);
    },
    cleanup: async () => order.push("cleanup"),
  });
  assert.deepEqual(order, [
    "provision", "firewall", "install-read-only-pull-credential",
    "pull-exact-digests", "inspect-local-digests", "start-postgres",
    "role-bootstrap", "migrator", "start-api", "start-worker", "start-web",
    "start-caddy", "healthz", "readyz-real-heartbeat", "hosted-browser-smoke",
    "spaces-pitr-restore", "persisted-live-coston2", "cleanup",
  ]);
  assert.equal(evidenceWrites, 1);
  assert.equal(result.status, "passed");
  assert.equal(result.environment, "staging");
  assert.equal(sshCommands.every((command) =>
    !JSON.stringify(command).match(/token|password|privateKey|:latest|docker build|pg_promote/i)), true);
});

test("028B staging failure retains publication evidence and cleans only run-owned staging", async () => {
  const module = await runtime();
  const evidence = publicationEvidence();
  const cleaned = [];
  let stagingEvidenceWrites = 0;
  let productionCalls = 0;
  const cause = await module.runDigitalOceanStaging({
    publicationEvidence: evidence,
    publicationEvidenceSha256: sha("9"),
    target: {
      origin: "https://staging.example.test",
      composeProject: "proofline-staging-failure",
      sshHostKeySha256: sha("8"),
    },
    digitalOceanAdapter: {
      provision: async () => ({ deploymentId: "do-staging-failure", owned: true }),
      applyFirewall: async () => undefined,
      production: async () => { productionCalls += 1; },
    },
    sshAdapter: {
      run: async (command) => {
        if (command.id === "readyz-real-heartbeat") throw new Error("staging-not-ready");
        return command.id === "inspect-local-digests"
          ? evidence.images.map(({ id, remoteDigest }) => ({ id, remoteDigest }))
          : { status: "passed" };
      },
    },
    appendStagingEvidence: async () => { stagingEvidenceWrites += 1; },
    cleanup: async (resource) => cleaned.push(resource),
  }).catch((error) => error);
  assert.equal(cause.code, "DIGITALOCEAN_STAGING_FAILED");
  assert.equal(cause.partial.publicationEvidenceRetained, true);
  assert.equal(cause.partial.stagingEvidenceWritten, false);
  assert.deepEqual(cleaned, [{ deploymentId: "do-staging-failure", owned: true }]);
  assert.equal(stagingEvidenceWrites, 0);
  assert.equal(productionCalls, 0);
  assert.doesNotMatch(JSON.stringify(cause), /secret|token|private|password/i);
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
