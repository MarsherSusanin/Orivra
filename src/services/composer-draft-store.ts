import type { Web2JsonManifestDraftV1 } from "../../packages/contracts/src";
import {
  decodeComposerDraftV1,
  serializeComposerDraftV1,
} from "../../packages/domain/src";

export const COMPOSER_DRAFT_STORAGE_KEY_V1 = "proofline:composer-draft:v1";

const MAX_DRAFT_UTF8_BYTES = 65_536;
const OPAQUE_TOKEN = /(?:project|share)_[a-f0-9]{64}/i;
const BEARER_CREDENTIAL = /\bbearer\s+\S+/i;
const PRIVATE_KEY = /(?:^|[^a-f0-9])0x[a-f0-9]{64}(?:$|[^a-f0-9])/i;
const SENSITIVE_QUERY_KEY = /^(?:authorization|api[-_]?key|access[-_]?token|token|password|private[-_]?key)$/i;

type DraftStoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type DraftLoadResult =
  | { state: "empty" }
  | { state: "restored"; draft: Web2JsonManifestDraftV1 }
  | {
      state: "rejected";
      reason: "corrupt" | "unsupported-version" | "oversized" | "invalid";
    }
  | { state: "unavailable" };

type DraftSaveResult =
  | { state: "stored" }
  | { state: "rejected"; reason: "invalid" | "oversized" | "sensitive-data" }
  | { state: "unavailable" };

function hasUrlCredentials(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.username.length > 0 || url.password.length > 0;
  } catch {
    return false;
  }
}

function containsSensitiveData(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const fields = record.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return false;
  const draftFields = fields as Record<string, unknown>;
  if (hasUrlCredentials(draftFields.sourceUrl)) return true;

  for (const candidate of [draftFields.sourceUrl, draftFields.jq, draftFields.abiSignature]) {
    if (
      typeof candidate === "string" &&
      (OPAQUE_TOKEN.test(candidate) ||
        BEARER_CREDENTIAL.test(candidate) ||
        PRIVATE_KEY.test(candidate))
    ) {
      return true;
    }
  }

  for (const collection of [draftFields.queryRows, draftFields.expectedQueryRows]) {
    if (!Array.isArray(collection)) continue;
    for (const candidate of collection) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        continue;
      }
      const row = candidate as Record<string, unknown>;
      if (typeof row.key === "string" && SENSITIVE_QUERY_KEY.test(row.key.trim())) {
        return true;
      }
      for (const cell of [row.key, row.value]) {
        if (
          typeof cell === "string" &&
          (OPAQUE_TOKEN.test(cell) ||
            BEARER_CREDENTIAL.test(cell) ||
            PRIVATE_KEY.test(cell))
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function createComposerDraftStore(storage: DraftStoragePort) {
  return {
    load(): DraftLoadResult {
      let raw: string | null;
      try {
        raw = storage.getItem(COMPOSER_DRAFT_STORAGE_KEY_V1);
      } catch {
        return { state: "unavailable" };
      }

      const decoded = decodeComposerDraftV1(raw);
      if (decoded.state === "restored" && containsSensitiveData(decoded.draft)) {
        try {
          storage.removeItem(COMPOSER_DRAFT_STORAGE_KEY_V1);
        } catch {
          // A rejected local value is never returned to the Composer.
        }
        return { state: "rejected", reason: "invalid" };
      }
      if (decoded.state !== "rejected") return decoded;

      try {
        storage.removeItem(COMPOSER_DRAFT_STORAGE_KEY_V1);
      } catch {
        // The invalid value stays inaccessible even when browser storage is locked.
      }
      return decoded;
    },

    save(draft: unknown): DraftSaveResult {
      if (containsSensitiveData(draft)) {
        return { state: "rejected", reason: "sensitive-data" };
      }

      let bytes: string;
      try {
        bytes = serializeComposerDraftV1(draft as Web2JsonManifestDraftV1);
      } catch {
        return { state: "rejected", reason: "invalid" };
      }
      if (utf8ByteLength(bytes) > MAX_DRAFT_UTF8_BYTES) {
        return { state: "rejected", reason: "oversized" };
      }

      try {
        storage.setItem(COMPOSER_DRAFT_STORAGE_KEY_V1, bytes);
        return { state: "stored" };
      } catch {
        return { state: "unavailable" };
      }
    },

    clear(): { state: "cleared" } | { state: "unavailable" } {
      try {
        storage.removeItem(COMPOSER_DRAFT_STORAGE_KEY_V1);
        return { state: "cleared" };
      } catch {
        return { state: "unavailable" };
      }
    },
  };
}
