import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const client = path.join(root, "dist", "client");

test("keeps wallet sign-in RPC code in one lazy production chunk under the initial budget", async () => {
  const html = await readFile(path.join(client, "index.html"), "utf8");
  const entryMatch = html.match(/<script[^>]+type="module"[^>]+src="([^"]+\.js)"/);
  assert.ok(entryMatch, "production index must reference one module entry");
  const entryName = path.basename(entryMatch[1]);
  const assets = path.join(client, "assets");
  const scripts = (await readdir(assets)).filter((name) => name.endsWith(".js"));
  const entry = await readFile(path.join(assets, entryName));
  const entrySource = entry.toString("utf8");

  assert.ok(
    gzipSync(entry).byteLength <= 180_000,
    `initial JavaScript exceeds 180 kB gzip: ${gzipSync(entry).byteLength}`,
  );
  for (const method of [
    "wallet_addEthereumChain",
    "eth_getCode",
    "personal_sign",
  ]) {
    assert.equal(entrySource.includes(method), false, `${method} leaked into initial entry`);
  }

  const lazyCandidates = [];
  for (const name of scripts.filter((name) => name !== entryName)) {
    const source = await readFile(path.join(assets, name), "utf8");
    if (source.includes("eth_requestAccounts") && source.includes("personal_sign")) {
      lazyCandidates.push({ name, source });
    }
  }
  assert.equal(lazyCandidates.length, 1, "wallet provider must compile into one lazy chunk");
  assert.match(lazyCandidates[0].name, /wallet-provider-adapter/i);
  assert.match(lazyCandidates[0].source, /eth_requestAccounts/);
  assert.match(lazyCandidates[0].source, /wallet_switchEthereumChain/);
  assert.match(lazyCandidates[0].source, /wallet_addEthereumChain/);
  assert.match(lazyCandidates[0].source, /eth_getCode/);
  assert.match(lazyCandidates[0].source, /personal_sign/);
});
