import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const files = {
  adr: "docs/adr/0029-digitalocean-vds-deployment.md",
  adrIndex: "docs/adr/README.md",
  adr0001: "docs/adr/0001-proofline-control-plane.md",
  adr0021: "docs/adr/0021-evidence-receipt-and-secure-handoff.md",
  adr0024: "docs/adr/0024-wallet-identity-and-self-service-access.md",
  readme: "README.md",
  architecture: "ARCHITECTURE.md",
  runbook: "docs/runbook.md",
  roadmap: "docs/development/product-roadmap.md",
  roles: "docs/development/roles.md",
  agents: "AGENTS.md",
  pullRequest: ".github/pull_request_template.md",
};

async function read(relativePath) {
  try {
    return await readFile(resolve(root, relativePath), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function readMany(keys) {
  return Object.fromEntries(
    await Promise.all(
      keys.map(async (key) => [key, await read(files[key])]),
    ),
  );
}

function requirePatterns(document, label, patterns) {
  for (const pattern of patterns) {
    assert.match(document, pattern, `${label} must document ${pattern}`);
  }
}

function requireCredentialFree029A(document, label) {
  requirePatterns(document, label, [
    /029A[\s\S]{0,240}credential[- ]free/i,
    /029A[\s\S]{0,320}(?:local MLP validation|local MLP candidate freeze|MLP validation and freeze)/i,
    /(?:product gates?|user testing|user validation)[\s\S]{0,240}(?:recorded )?fixtures?/i,
    /(?:recorded )?fixtures?[\s\S]{0,240}(?:local )?(?:Docker )?Compose/i,
    /029A[\s\S]{0,720}(?:no|without)[\s\S]{0,80}credentials?[\s\S]{0,160}(?:no|without)[\s\S]{0,80}(?:external )?network/i,
    /029B[\s\S]{0,280}(?:credentialed|credentials?)[\s\S]{0,280}(?:production )?promotion[\s\S]{0,160}canary/i,
    /029B[\s\S]{0,240}(?:after|only after)[\s\S]{0,120}028B/i,
  ]);
}

test("ADR 0029 is accepted, indexed, and supersedes only the Sites-host portions of prior decisions", async () => {
  const documents = await readMany([
    "adr",
    "adrIndex",
    "adr0001",
    "adr0021",
    "adr0024",
  ]);

  assert.notEqual(documents.adr, "", `${files.adr} must exist`);
  requirePatterns(documents.adr, "ADR 0029", [
    /Status:\s*accepted/i,
    /supersed(?:e|es|ed|ing)[\s\S]{0,160}only[\s\S]{0,160}Sites[\s-]?host/i,
    /ADR\s*0001/i,
    /ADR\s*0021/i,
    /ADR\s*0024/i,
    /all other|remaining decisions|otherwise remain/i,
  ]);
  assert.match(
    documents.adrIndex,
    /\[0029\]\(0029-digitalocean-vds-deployment\.md\)/,
  );

  for (const [key, number] of [
    ["adr0001", "0001"],
    ["adr0021", "0021"],
    ["adr0024", "0024"],
  ]) {
    requirePatterns(documents[key], `ADR ${number}`, [
      /0029-digitalocean-vds-deployment\.md/,
      /partially superseded|superseded only|Sites-host(?:ing)? portion/i,
    ]);
  }
});

test("the accepted topology is one DigitalOcean VDS with Compose, Caddy, and same-origin API routing", async () => {
  const { adr, architecture, runbook } = await readMany([
    "adr",
    "architecture",
    "runbook",
  ]);

  for (const [label, document] of [
    ["ADR 0029", adr],
    ["ARCHITECTURE.md", architecture],
    ["runbook", runbook],
  ]) {
    requirePatterns(document, label, [
      /DigitalOcean/i,
      /Droplet|\bVDS\b/i,
      /Docker Compose/i,
      /Caddy/i,
      /\bWeb\b[\s\S]{0,240}\bAPI\b[\s\S]{0,240}\bworker\b[\s\S]{0,240}PostgreSQL/i,
      /same[- ]origin[\s\S]{0,160}\/api/i,
    ]);
  }

  requirePatterns(adr, "ADR 0029", [
    /same (?:Droplet|VDS)|single (?:Droplet|VDS)/i,
    /Caddy[\s\S]{0,160}reverse prox/i,
    /Sites[\s\S]{0,160}compatibility only|compatibility-only[\s\S]{0,160}Sites/i,
  ]);
});

test("the host exposure contract permits only HTTP(S) and restricted SSH", async () => {
  const { adr, architecture, runbook, agents } = await readMany([
    "adr",
    "architecture",
    "runbook",
    "agents",
  ]);
  const operational = `${adr}\n${architecture}\n${runbook}`;

  requirePatterns(operational, "deployment boundary", [
    /(?:public|inbound)[\s\S]{0,160}\b80\b[\s\S]{0,80}\b443\b/i,
    /SSH[\s\S]{0,160}(?:restricted|allowlist|VPN)/i,
    /(?:no|never|must not|do not expose)[\s\S]{0,120}(?:host port\s*)?5432/i,
    /(?:no|never|must not|do not expose)[\s\S]{0,180}(?:API|worker)[\s\S]{0,120}(?:host port|public)/i,
    /(?:no|never|must not|do not expose)[\s\S]{0,160}Docker socket/i,
  ]);
  requirePatterns(agents, "AGENTS.md", [
    /ADR\s*0029|0029-digitalocean-vds-deployment/i,
    /80\/443|ports? 80 and 443/i,
    /SSH[\s\S]{0,120}(?:restricted|allowlist|VPN)/i,
    /5432[\s\S]{0,160}(?:not exposed|private|internal only)/i,
  ]);
});

test("release composition uses immutable images and a one-shot locked migration before app startup", async () => {
  const { adr, architecture, runbook } = await readMany([
    "adr",
    "architecture",
    "runbook",
  ]);
  const release = `${adr}\n${architecture}\n${runbook}`;

  requirePatterns(release, "release composition", [
    /GHCR/i,
    /immutable[\s\S]{0,120}(?:digest|@sha256)/i,
    /one[- ]shot[\s\S]{0,160}migration/i,
    /migration[\s\S]{0,240}before[\s\S]{0,80}(?:app|API|worker)/i,
    /checksum(?:med|s)?[\s\S]{0,160}migration/i,
    /advisory lock/i,
    /schema(?: version)?[\s\S]{0,120}verif/i,
    /\/healthz/i,
    /\/readyz/i,
    /worker heartbeat/i,
    /PostgreSQL[\s\S]{0,160}(?:persistent|named) volume/i,
  ]);
});

test("database recovery uses off-host WAL and base backups, with a local MinIO restore drill", async () => {
  const { adr, runbook } = await readMany(["adr", "runbook"]);

  for (const [label, document] of [
    ["ADR 0029", adr],
    ["runbook", runbook],
  ]) {
    requirePatterns(document, label, [
      /WAL/i,
      /base backup/i,
      /PITR|point[- ]in[- ]time recovery/i,
      /private[\s\S]{0,140}S3[- ]compatible[\s\S]{0,140}(?:Spaces|DigitalOcean)/i,
      /MinIO[\s\S]{0,160}restore drill/i,
      /Droplet backup[\s\S]{0,180}(?:not|does not)[\s\S]{0,120}(?:database|PITR)/i,
    ]);
  }
});

test("roadmap keeps credentials out until credential-free modules, one unified matrix, and two PASS reports finish", async () => {
  const { roadmap, roles, runbook, pullRequest } = await readMany([
    "roadmap",
    "roles",
    "runbook",
    "pullRequest",
  ]);

  requirePatterns(roadmap, "product roadmap", [
    /027A/i,
    /027B/i,
    /027C/i,
    /028A[\s\S]{0,160}local release/i,
    /028B[\s\S]{0,160}credential gate/i,
    /029[\s\S]{0,160}(?:promotion|canary)/i,
    /022[\s–-]*029A[\s\S]{0,180}credential[- ]free/i,
    /credentials?[\s\S]{0,180}(?:after|only after)[\s\S]{0,220}(?:full|unified)[\s\S]{0,80}matrix/i,
    /two independent[\s\S]{0,100}PASS[\s\S]{0,100}(?:same|one)[\s\S]{0,60}tree/i,
    /(?:credentials?[\s,]*)?DNS[\s\S]{0,100}SSH[\s\S]{0,100}Spaces[\s\S]{0,180}(?:strictly|only)[\s\S]{0,80}after[\s\S]{0,120}022[\s–-]*029A/i,
  ]);
  for (const [label, document] of [
    ["roles", roles],
    ["runbook", runbook],
    ["pull request template", pullRequest],
  ]) {
    requirePatterns(document, label, [
      /targeted|focused/i,
      /full|unified/i,
      /matrix/i,
      /once[\s\S]{0,160}(?:after|when)[\s\S]{0,160}(?:modules|022[\s–-]*029A)/i,
      /two independent|both independent/i,
      /tree hash/i,
      /credentials?|DNS|SSH|Spaces/i,
    ]);
  }
});

test("every canonical operating document points to the selected DigitalOcean decision", async () => {
  const canonicalKeys = [
    "readme",
    "architecture",
    "runbook",
    "roadmap",
    "roles",
    "agents",
    "pullRequest",
  ];
  const documents = await readMany(canonicalKeys);

  for (const key of canonicalKeys) {
    requirePatterns(documents[key], files[key], [
      /ADR\s*0029|0029-digitalocean-vds-deployment|DigitalOcean/i,
    ]);
  }

});

test("the current documentation makes no hosted or Render production claim", async () => {
  const documents = await readMany([
    "readme",
    "architecture",
    "runbook",
    "roadmap",
    "roles",
    "agents",
    "pullRequest",
  ]);
  const aggregate = Object.values(documents).join("\n");

  requirePatterns(aggregate, "canonical current-state wording", [
    /not (?:currently )?(?:hosted|deployed|provisioned)|no current hosted|hosting is not yet provisioned|не (?:размещен|размещены|размещено|разв[её]рнут|настроен)/i,
  ]);
  assert.doesNotMatch(
    aggregate,
    /render\.com|render\.yaml|Render (?:is|as|becomes|hosts?|deploys?)[\s\S]{0,100}(?:production|hosting|target|API|worker|PostgreSQL)/i,
  );
  await assert.rejects(access(resolve(root, "render.yaml")));
});

test("029A is the satisfiable credential-free local MLP freeze and 029B owns credentialed promotion", async () => {
  const documents = await readMany([
    "adr",
    "roadmap",
    "runbook",
    "roles",
    "agents",
  ]);

  for (const [key, label] of [
    ["adr", "ADR 0029"],
    ["roadmap", "product roadmap"],
    ["runbook", "runbook"],
    ["roles", "development roles"],
    ["agents", "AGENTS.md"],
  ]) {
    requireCredentialFree029A(documents[key], label);
    assert.match(
      documents[key],
      /022[\s–-]*029A[\s\S]{0,180}credential[- ]free/i,
      `${label} must keep every credential authorization bound to the now-defined 022–029A range`,
    );
  }
});

test("028A creates verified local OCI archives and a frozen digest manifest without registry access", async () => {
  const documents = await readMany(["adr", "roadmap", "runbook"]);

  for (const [key, label] of [
    ["adr", "ADR 0029"],
    ["roadmap", "product roadmap"],
    ["runbook", "runbook"],
  ]) {
    requirePatterns(documents[key], label, [
      /028A[\s\S]{0,240}local/i,
      /028A[\s\S]{0,360}(?:builds?|creates?|exports?)[\s\S]{0,160}OCI (?:image )?archives?/i,
      /028A[\s\S]{0,480}(?:digest|release) manifest/i,
      /OCI (?:image )?archives?[\s\S]{0,240}(?:verified|verification|verify)/i,
      /OCI (?:image )?archives?[\s\S]{0,240}(?:SHA-256|sha256|checksum|digest)/i,
      /028A[\s\S]{0,600}(?:without|no)[\s\S]{0,100}(?:registry|GHCR)[\s\S]{0,80}credentials?/i,
      /028A[\s\S]{0,600}(?:no|without)[\s\S]{0,100}(?:registry|external)[\s\S]{0,80}(?:access|network|push)/i,
    ]);
  }
});

test("028B publishes the exact frozen OCI bytes to GHCR and fails closed before staging pull", async () => {
  const documents = await readMany([
    "adr",
    "roadmap",
    "runbook",
    "roles",
    "agents",
  ]);

  for (const [key, label] of [
    ["adr", "ADR 0029"],
    ["roadmap", "product roadmap"],
    ["runbook", "runbook"],
  ]) {
    requirePatterns(documents[key], label, [
      /028B[\s\S]{0,240}credentialed/i,
      /028B[\s\S]{0,520}byte[- ]preserving/i,
      /028B[\s\S]{0,520}(?:load[\s/,]+copy[\s/,]+push|load\/copy\/push)[\s\S]{0,160}(?:exact|same|frozen)[\s\S]{0,120}OCI/i,
      /028B[\s\S]{0,500}(?:after|only after)[\s\S]{0,180}two[\s\S]{0,80}PASS/i,
      /028B[\s\S]{0,620}(?:no rebuild|without rebuild|must not rebuild|never rebuild)/i,
      /remote (?:image )?digest[\s\S]{0,220}(?:equals?|matches?)[\s\S]{0,180}(?:frozen|release) manifest/i,
      /digest mismatch[\s\S]{0,120}(?:abort|blocks?|fail(?:s)? closed)/i,
      /(?:before|prior to)[\s\S]{0,100}staging pull/i,
      /(?:VDS|Droplet)[\s\S]{0,180}GHCR pull credential[\s\S]{0,120}read[- ]only/i,
      /publication evidence[\s\S]{0,180}(?:joins?|part of|included in)[\s\S]{0,120}(?:frozen )?release manifest/i,
    ]);
  }

  requirePatterns(`${documents.roles}\n${documents.agents}`, "agent and verifier boundary", [
    /028A[\s\S]{0,300}OCI/i,
    /028B[\s\S]{0,360}(?:no rebuild|without rebuild|must not rebuild|never rebuild)/i,
    /remote (?:image )?digest[\s\S]{0,200}(?:equals?|matches?)[\s\S]{0,180}(?:frozen|release) manifest/i,
    /publication evidence[\s\S]{0,180}(?:release manifest|candidate evidence)/i,
  ]);
});
