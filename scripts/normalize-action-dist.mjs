import { readFile, writeFile } from "node:fs/promises";

const actionDistPath = new URL("../packages/action/dist/index.js", import.meta.url);
const source = await readFile(actionDistPath, "utf8");
const normalized = source.replace(/[\t ]+$/gm, "");

if (normalized !== source) {
  await writeFile(actionDistPath, normalized, "utf8");
}
