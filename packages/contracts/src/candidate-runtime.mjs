import { z } from "zod";
import { canonicalJson, sha256Bytes } from "./release-runtime.mjs";

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const CommitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);

export const credentialFreeCandidateGateIds = Object.freeze([
  "typecheck",
  "unit",
  "core-coverage",
  "backend-coverage",
  "web-coverage",
  "postgres",
  "solidity",
  "e2e",
  "build",
  "sites",
  "action-artifact",
  "docker-static",
  "docker-images",
  "docker-runtime",
  "docker-recovery",
  "release-freeze",
  "product-compose",
]);

const GateSchema = (id) => z.object({
  id: z.literal(id),
  status: z.literal("passed"),
}).strict();

export const CredentialFreeMlpCandidateV1Schema = z.object({
  version: z.literal("1"),
  kind: z.literal("credential-free-mlp-candidate"),
  status: z.literal("passed"),
  verification: z.literal("verified"),
  releaseClaim: z.literal(true),
  credentialFree: z.literal(true),
  externalNetwork: z.literal(false),
  producer: z.object({
    commitSha: CommitShaSchema,
    treeSha: CommitShaSchema,
  }).strict().refine((value) => value.commitSha !== value.treeSha, {
    path: ["treeSha"],
  }),
  frozenRelease: z.object({
    manifestSha256: Sha256Schema,
    receiptSha256: Sha256Schema,
    artifactInventorySha256: Sha256Schema,
  }).strict(),
  product: z.object({
    fixtureFilename: z.literal("recorded-product-fixture.v1.json"),
    fixtureSha256: Sha256Schema,
    mode: z.literal("checked-in-recorded-fixture"),
    publicOrigin: z.literal("https://127.0.0.1"),
    worker: z.literal("stopped"),
    status: z.literal("passed"),
  }).strict(),
  gates: z.tuple(credentialFreeCandidateGateIds.map(GateSchema)),
}).strict();

export function canonicalSerializeCredentialFreeMlpCandidate(value) {
  return canonicalJson(CredentialFreeMlpCandidateV1Schema.parse(value));
}

export function checksumCredentialFreeMlpCandidate(value) {
  return sha256Bytes(new TextEncoder().encode(
    canonicalSerializeCredentialFreeMlpCandidate(value),
  ));
}
