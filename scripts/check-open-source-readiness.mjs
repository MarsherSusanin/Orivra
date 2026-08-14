#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_FILES = [
  "README.md",
  "LICENSE",
  "NOTICE",
  "LICENSES/MIT.txt",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
];
const REQUIRED_HEADINGS = [
  "## Problem and target user",
  "## 2–3 minute quickstart",
  "## Flare and Coston2 integration path",
  "## Architecture overview",
  "## Hackathon work",
  "## Build and testing",
  "## Security",
  "## License",
];

function fail(message) {
  throw new Error(`Open-source readiness failed: ${message}`);
}

async function json(relativePath) {
  return JSON.parse(await readFile(resolve(ROOT, relativePath), "utf8"));
}

function packageManifests() {
  const files = ["package.json"];
  for (const parent of ["apps", "packages"]) {
    for (const entry of readdirSync(resolve(ROOT, parent), { withFileTypes: true })) {
      if (entry.isDirectory()) files.push(join(parent, entry.name, "package.json"));
    }
  }
  return files.sort();
}

for (const relativePath of REQUIRED_FILES) {
  const absolutePath = resolve(ROOT, relativePath);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile() || statSync(absolutePath).size === 0) {
    fail(`${relativePath} is missing or empty`);
  }
}

const rootPackage = await json("package.json");
if (rootPackage.license !== "Apache-2.0" || rootPackage.private !== true) fail("root package license/private metadata is invalid");
if (rootPackage.packageManager !== "npm@10.9.2") fail("packageManager must remain npm@10.9.2");
if (rootPackage.engines?.node !== "22.x" || rootPackage.engines?.npm !== "10.x") fail("root Node/npm engines are invalid");
if (rootPackage.repository?.url !== "git+https://github.com/MarsherSusanin/Orivra.git") fail("repository URL is invalid");
if (rootPackage.homepage !== "https://orivra.xyz") fail("homepage is invalid");
if (rootPackage.bugs?.url !== "https://github.com/MarsherSusanin/Orivra/issues") fail("bugs URL is invalid");

for (const relativePath of packageManifests()) {
  const packageJson = await json(relativePath);
  if (packageJson.private !== true) fail(`${relativePath} must remain private`);
  if (packageJson.license !== "Apache-2.0") fail(`${relativePath} must declare Apache-2.0`);
}

for (const relativePath of ["README.md", "CONTRIBUTING.md", "SECURITY.md"]) {
  const content = await readFile(resolve(ROOT, relativePath), "utf8");
  if (/[\u0400-\u04ff]/u.test(content)) fail(`${relativePath} must be English-only`);
}

const readme = await readFile(resolve(ROOT, "README.md"), "utf8");
for (const heading of REQUIRED_HEADINGS) {
  if (!readme.includes(heading)) fail(`README is missing ${heading}`);
}
for (const requiredLink of [
  "https://orivra.xyz",
  "https://orivra.xyz/demo/canonical-url",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "LICENSE",
]) {
  if (!readme.includes(requiredLink)) fail(`README is missing ${requiredLink}`);
}

const license = await readFile(resolve(ROOT, "LICENSE"), "utf8");
if (!license.includes("Apache License") || !license.includes("Version 2.0, January 2004") || !license.includes("END OF TERMS AND CONDITIONS")) {
  fail("LICENSE is not the Apache-2.0 text");
}

const trackedFiles = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT })
  .toString("utf8").split("\0").filter(Boolean);
const secretFilePattern = /(^|\/)(?:\.env(?:\..+)?|id_(?:rsa|ed25519)|[^/]+\.(?:pem|p12|pfx|jks|keystore|key))$/iu;
const prohibited = trackedFiles.filter((path) => secretFilePattern.test(path) && path !== ".env.example");
if (prohibited.length > 0) fail(`secret-like filenames are tracked: ${prohibited.join(", ")}`);

process.stdout.write(`Open-source readiness passed for ${packageManifests().length} first-party package manifests.\n`);
