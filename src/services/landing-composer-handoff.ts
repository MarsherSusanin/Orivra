import {
  Web2JsonManifestDraftV1Schema,
  isSafePublicUrlQueryEntry,
  type Web2JsonManifestDraftV1,
} from "../../packages/contracts/src";
import {
  deriveTrustFromSourceUrl,
  validateComposerSourceUrl,
} from "../../packages/domain/src";

export const LANDING_COMPOSER_HANDOFF_STORAGE_KEY_V1 =
  "proofline:landing-composer-handoff:v1";

const MAX_HANDOFF_UTF8_BYTES = 65_536;

type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type LandingPreview =
  | {
      valid: true;
      trust: ReturnType<typeof deriveTrustFromSourceUrl>;
    }
  | {
      valid: false;
      issue: { code: string; message: string };
    };

type LandingDraftResult =
  | { valid: true; draft: Web2JsonManifestDraftV1 }
  | { valid: false; issue: { code: string; message: string } };

function invalid(code: string, message: string): LandingPreview {
  return { valid: false, issue: { code, message } };
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function previewLandingSourceUrl(sourceUrl: string): LandingPreview {
  if (sourceUrl.length === 0) {
    return invalid("SOURCE_URL_REQUIRED", "Enter a public HTTPS endpoint.");
  }
  if (sourceUrl.length > 2_048) {
    return invalid("SOURCE_URL_OVERSIZED", "The endpoint must be 2,048 characters or fewer.");
  }
  const sourceValidation = validateComposerSourceUrl(sourceUrl);
  if (!sourceValidation.valid) {
    return invalid(sourceValidation.issue.code, sourceValidation.issue.message);
  }

  const source = new URL(sourceUrl);
  const seen = new Set<string>();
  for (const [name, value] of source.searchParams) {
    if (seen.has(name)) {
      return invalid(
        "SOURCE_URL_DUPLICATE_QUERY",
        `Query parameter “${name}” appears more than once. Use one explicit value.`,
      );
    }
    seen.add(name);
    if (!isSafePublicUrlQueryEntry(name, value)) {
      return invalid(
        "SOURCE_URL_CREDENTIAL_QUERY",
        "Credential and signed-URL query entries are not accepted. Use a public endpoint.",
      );
    }
  }

  return { valid: true, trust: deriveTrustFromSourceUrl(sourceUrl) };
}

export function createLandingComposerDraft(input: {
  sourceUrl: string;
  updatedAt: string;
  createIdempotencyKey: string;
}): LandingDraftResult {
  const preview = previewLandingSourceUrl(input.sourceUrl);
  if (!preview.valid) return preview;

  const parsed = Web2JsonManifestDraftV1Schema.safeParse({
    version: "1",
    step: "source",
    updatedAt: input.updatedAt,
    createIdempotencyKey: input.createIdempotencyKey,
    fields: {
      sourceUrl: input.sourceUrl,
      queryRows: [],
      jq: "",
      abiSignature: "",
      ...preview.trust,
      submissionMode: "replay",
      feeCapWei: "",
    },
  });
  if (!parsed.success) {
    return {
      valid: false,
      issue: {
        code: "SOURCE_DRAFT_INVALID",
        message: "This endpoint cannot be staged as a bounded Composer draft.",
      },
    };
  }
  return { valid: true, draft: parsed.data };
}

export function stageLandingComposerHandoff(
  storage: StoragePort,
  draft: Web2JsonManifestDraftV1,
): { state: "stored" | "rejected" | "unavailable" } {
  const parsed = Web2JsonManifestDraftV1Schema.safeParse(draft);
  if (!parsed.success || !previewLandingSourceUrl(draft.fields.sourceUrl).valid) {
    return { state: "rejected" };
  }
  const raw = JSON.stringify({ version: "1", source: "landing-url", draft: parsed.data });
  if (utf8Bytes(raw) > MAX_HANDOFF_UTF8_BYTES) return { state: "rejected" };
  try {
    storage.setItem(LANDING_COMPOSER_HANDOFF_STORAGE_KEY_V1, raw);
    return { state: "stored" };
  } catch {
    return { state: "unavailable" };
  }
}

export function consumeLandingComposerHandoff(
  storage: StoragePort,
):
  | { state: "empty" | "rejected" | "unavailable" }
  | { state: "restored"; draft: Web2JsonManifestDraftV1 } {
  let raw: string | null;
  try {
    raw = storage.getItem(LANDING_COMPOSER_HANDOFF_STORAGE_KEY_V1);
    storage.removeItem(LANDING_COMPOSER_HANDOFF_STORAGE_KEY_V1);
  } catch {
    return { state: "unavailable" };
  }
  if (raw === null) return { state: "empty" };
  if (utf8Bytes(raw) > MAX_HANDOFF_UTF8_BYTES) return { state: "rejected" };
  try {
    const decoded = JSON.parse(raw) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return { state: "rejected" };
    }
    const record = decoded as Record<string, unknown>;
    if (
      Object.keys(record).sort().join(",") !== "draft,source,version" ||
      record.version !== "1" ||
      record.source !== "landing-url"
    ) {
      return { state: "rejected" };
    }
    const draft = Web2JsonManifestDraftV1Schema.safeParse(record.draft);
    if (!draft.success || !previewLandingSourceUrl(draft.data.fields.sourceUrl).valid) {
      return { state: "rejected" };
    }
    return { state: "restored", draft: draft.data };
  } catch {
    return { state: "rejected" };
  }
}
