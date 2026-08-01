import {
  ArrowLeft,
  ArrowRight,
  FileArrowUp,
  LockKey,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import type { ChangeEvent, MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CreateRunResultV1Schema,
  type ComposerStepV1,
  type Web2JsonDraftQueryRowV1,
  type Web2JsonManifestDraftV1,
} from "../../packages/contracts/src";
import {
  createEthUsdComposerDraft,
  deriveTrustFromSourceUrl,
  finalizeWeb2JsonManifestDraft,
  importWeb2JsonManifestDraft,
  validateComposerTransformFields,
  validateComposerTrustFields,
  validateComposerSourceUrl,
  type ComposerFinalizationIssue,
} from "../../packages/domain/src";
import { createComposerDraftStore } from "../services/composer-draft-store";
import type { RunSurfaceServices } from "../services/run-surface";

const COMPOSER_STEPS: readonly ComposerStepV1[] = [
  "source",
  "transform",
  "trust",
  "submit",
];
const MAX_IMPORT_BYTES = 64 * 1024;

type TrustDirtyState = {
  host: boolean;
  path: boolean;
  query: boolean;
};

const CLEAN_TRUST: TrustDirtyState = { host: false, path: false, query: false };
const UNAVAILABLE_DRAFT_STORAGE = {
  getItem(): string | null {
    throw new DOMException("Storage unavailable", "SecurityError");
  },
  setItem(): void {
    throw new DOMException("Storage unavailable", "SecurityError");
  },
  removeItem(): void {
    throw new DOMException("Storage unavailable", "SecurityError");
  },
};

function browserDraftStorage() {
  try {
    const storage = globalThis.localStorage;
    const prototype = globalThis.Storage?.prototype;
    if (!storage) return UNAVAILABLE_DRAFT_STORAGE;
    if (!prototype) return storage;
    return {
      getItem: (key: string) => prototype.getItem.call(storage, key),
      setItem: (key: string, value: string) => prototype.setItem.call(storage, key, value),
      removeItem: (key: string) => prototype.removeItem.call(storage, key),
    };
  } catch {
    return UNAVAILABLE_DRAFT_STORAGE;
  }
}

function displayStep(step: ComposerStepV1): string {
  return step.charAt(0).toUpperCase() + step.slice(1);
}

function stepFromLocation(): ComposerStepV1 {
  const value = new URLSearchParams(globalThis.location?.search ?? "").get("step");
  return COMPOSER_STEPS.includes(value as ComposerStepV1)
    ? value as ComposerStepV1
    : "source";
}

function stepHref(step: ComposerStepV1): string {
  const url = new URL(globalThis.location.href);
  url.searchParams.set("step", step);
  return `${url.pathname}${url.search}${url.hash}`;
}

function randomUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function blankDraft(step: ComposerStepV1 = "source"): Web2JsonManifestDraftV1 {
  return {
    version: "1",
    step,
    updatedAt: new Date().toISOString(),
    createIdempotencyKey: `composer_${randomUuid()}`,
    fields: {
      sourceUrl: "",
      queryRows: [],
      jq: "",
      abiSignature: "",
      expectedScheme: "https",
      expectedHost: "",
      expectedPathPrefix: "",
      expectedQueryRows: [],
      submissionMode: "replay",
      feeCapWei: "",
    },
  };
}

function newDraft(step = stepFromLocation()): Web2JsonManifestDraftV1 {
  const base = {
    updatedAt: new Date().toISOString(),
    createIdempotencyKey: `composer_${randomUuid()}`,
  };
  const template = new URLSearchParams(globalThis.location?.search ?? "").get("template");
  const created = template === "eth-usd"
    ? createEthUsdComposerDraft(base)
    : blankDraft(step);
  return { ...created, step };
}

function updateRow(
  rows: readonly Web2JsonDraftQueryRowV1[],
  id: string,
  field: "key" | "value",
  value: string,
): Web2JsonDraftQueryRowV1[] {
  return rows.map((row) => row.id === id ? { ...row, [field]: value } : row);
}

function queryRowsFromSource(
  sourceRows: readonly Web2JsonDraftQueryRowV1[],
  urlRows: readonly Web2JsonDraftQueryRowV1[],
): Web2JsonDraftQueryRowV1[] {
  const merged = new Map(urlRows.map(({ key, value }) => [key, value]));
  for (const row of sourceRows) {
    const key = row.key.trim();
    if (key) merged.set(key, row.value);
  }
  return [...merged.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value], index) => ({ id: `expected-query-${index}`, key, value }));
}

function QueryRows({
  rows,
  kind,
  keyErrors,
  onAdd,
  onChange,
  onRemove,
}: {
  rows: readonly Web2JsonDraftQueryRowV1[];
  kind: "source" | "expected";
  keyErrors?: Readonly<Record<string, string>>;
  onAdd(): void;
  onChange(id: string, field: "key" | "value", value: string): void;
  onRemove(id: string): void;
}) {
  const expected = kind === "expected";
  const groupName = expected ? "Expected query" : "Source query";
  const labelPrefix = expected ? "Expected query" : "Query";
  return (
    <fieldset className="composer-query" aria-label={groupName}>
      <legend className="visually-hidden">{groupName}</legend>
      <div className="composer-field-heading">
        <strong>{groupName}</strong>
        <button
          className="composer-add"
          type="button"
          onClick={onAdd}
          aria-label={expected ? "Add expected query" : "Add query parameter"}
        >
          <Plus size={15} weight="bold" aria-hidden="true" />Add parameter
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="composer-empty-row">No explicit query parameters.</p>
      ) : (
        <div className="composer-query-rows">
          {rows.map((row) => (
            <div className="composer-query-row" key={row.id}>
              <label>
                <span>{labelPrefix} key</span>
                <input
                  aria-label={`${labelPrefix} key`}
                  aria-invalid={keyErrors?.[row.id] ? "true" : undefined}
                  aria-describedby={keyErrors?.[row.id] ? `query-key-error-${row.id}` : undefined}
                  autoComplete="off"
                  maxLength={128}
                  value={row.key}
                  onChange={(event) => onChange(row.id, "key", event.target.value)}
                />
                {keyErrors?.[row.id] ? (
                  <span className="composer-error" id={`query-key-error-${row.id}`}>
                    {keyErrors[row.id]}
                  </span>
                ) : null}
              </label>
              <label>
                <span>{labelPrefix} value</span>
                <input
                  aria-label={`${labelPrefix} value`}
                  autoComplete="off"
                  maxLength={2048}
                  value={row.value}
                  onChange={(event) => onChange(row.id, "value", event.target.value)}
                />
              </label>
              <button
                className="composer-remove"
                type="button"
                onClick={() => onRemove(row.id)}
                aria-label={expected ? "Remove expected query" : "Remove query parameter"}
              >
                <Trash size={17} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export function ManifestComposer({
  onConnect,
  onStart,
  projectToken,
  services,
  onManifestValidated,
  onRunCreated,
}: {
  onConnect(): void;
  onStart(): void;
  projectToken: string;
  services: Pick<RunSurfaceServices, "createRun">;
  onManifestValidated(outcome: "accepted" | "rejected"): void;
  onRunCreated(runId: string): void;
}) {
  const draftStore = useMemo(
    () => createComposerDraftStore(browserDraftStorage()),
    [],
  );
  const [startup] = useState(() => {
    const loaded = draftStore.load();
    const requestedStep = stepFromLocation();
    if (loaded.state === "restored") {
      return {
        draft: loaded.draft as Web2JsonManifestDraftV1 | null,
        step: loaded.draft.step,
        restoreState: "restored" as const,
        storageUnavailable: false,
      };
    }
    if (loaded.state === "rejected") {
      return {
        draft: null,
        step: requestedStep,
        restoreState: "rejected" as const,
        storageUnavailable: false,
      };
    }
    return {
      draft: newDraft(requestedStep) as Web2JsonManifestDraftV1 | null,
      step: requestedStep,
      restoreState: "fresh" as const,
      storageUnavailable: loaded.state === "unavailable",
    };
  });
  const [step, setStep] = useState<ComposerStepV1>(startup.step);
  const [draft, setDraft] = useState<Web2JsonManifestDraftV1 | null>(startup.draft);
  const [restoreState, setRestoreState] = useState(startup.restoreState);
  const [storageUnavailable, setStorageUnavailable] = useState(
    startup.storageUnavailable,
  );
  const [sourceError, setSourceError] = useState("");
  const [jqError, setJqError] = useState("");
  const [abiError, setAbiError] = useState("");
  const [hostError, setHostError] = useState("");
  const [pathError, setPathError] = useState("");
  const [queryKeyErrors, setQueryKeyErrors] = useState<Record<string, string>>({});
  const [importError, setImportError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [focusField, setFocusField] = useState<"sourceUrl" | "jq" | "abiSignature" | null>(null);
  const trustDirty = useRef<TrustDirtyState>({ ...CLEAN_TRUST });
  const trustValidationAttempted = useRef(false);
  const startRecorded = useRef(false);
  const submissionPending = useRef(false);
  const sourceRef = useRef<HTMLInputElement>(null);
  const jqRef = useRef<HTMLTextAreaElement>(null);
  const abiRef = useRef<HTMLTextAreaElement>(null);
  const hasTemplate = new URLSearchParams(globalThis.location?.search ?? "").get("template") === "eth-usd";

  const recordStartOnce = () => {
    if (startRecorded.current) return;
    startRecorded.current = true;
    onStart();
  };

  useEffect(() => {
    const restoreStep = () => {
      const locationStep = stepFromLocation();
      const requested = new URLSearchParams(globalThis.location.search).get("step");
      const restored = restoreState === "restored" && draft
        ? draft.step
        : locationStep;
      if (requested !== restored) {
        globalThis.history.replaceState({}, "", stepHref(restored));
      }
      setStep(restored);
    };
    restoreStep();
    globalThis.addEventListener("popstate", restoreStep);
    return () => globalThis.removeEventListener("popstate", restoreStep);
  }, [draft, restoreState]);

  useEffect(() => {
    if (!focusField) return;
    const target = focusField === "sourceUrl"
      ? sourceRef.current
      : focusField === "jq"
        ? jqRef.current
        : abiRef.current;
    target?.focus();
    setFocusField(null);
  }, [focusField, step]);

  const persistDraft = (next: Web2JsonManifestDraftV1) => {
    const result = draftStore.save(next);
    setStorageUnavailable(result.state !== "stored");
  };

  const replaceDraft = (next: Web2JsonManifestDraftV1) => {
    setDraft(next);
    persistDraft(next);
  };

  const setFields = (
    updater: (fields: Web2JsonManifestDraftV1["fields"]) => Web2JsonManifestDraftV1["fields"],
  ) => {
    if (!draft) return;
    replaceDraft({
      ...draft,
      updatedAt: new Date().toISOString(),
      fields: updater(draft.fields),
    });
  };

  const applyTrustValidation = (fields: Web2JsonManifestDraftV1["fields"]): boolean => {
    const validation = validateComposerTrustFields({
      expectedScheme: fields.expectedScheme,
      expectedHost: fields.expectedHost,
      expectedPathPrefix: fields.expectedPathPrefix,
      expectedQueryRows: fields.expectedQueryRows,
    });
    if (validation.valid) {
      setHostError("");
      setPathError("");
      setQueryKeyErrors({});
      return true;
    }

    let nextHostError = "";
    let nextPathError = "";
    const nextQueryKeyErrors: Record<string, string> = {};
    for (const issue of validation.issues) {
      if (issue.field === "expectedHost") nextHostError = issue.message;
      else if (issue.field === "expectedPathPrefix") nextPathError = issue.message;
      else {
        const match = /^expectedQueryRows\.(\d+)\.key$/.exec(issue.field);
        const row = match ? fields.expectedQueryRows[Number(match[1])] : undefined;
        if (row) nextQueryKeyErrors[row.id] = issue.message;
      }
    }
    setHostError(nextHostError);
    setPathError(nextPathError);
    setQueryKeyErrors(nextQueryKeyErrors);
    return false;
  };

  const navigateStep = (event: MouseEvent<HTMLAnchorElement>, next: ComposerStepV1) => {
    event.preventDefault();
    goToStep(next);
  };

  const goToStep = (
    next: ComposerStepV1,
    base: Web2JsonManifestDraftV1 | null = draft,
  ) => {
    globalThis.history.pushState({}, "", stepHref(next));
    if (base) {
      replaceDraft({
        ...base,
        step: next,
        updatedAt: new Date().toISOString(),
      });
    }
    setStep(next);
  };

  const addQueryRow = (kind: "source" | "expected") => {
    if (!draft) return;
    const row: Web2JsonDraftQueryRowV1 = {
      id: `${kind}-query-${randomUuid()}`,
      key: "",
      value: "",
    };
    if (kind === "expected") trustDirty.current.query = true;
    const fieldName = kind === "source" ? "queryRows" : "expectedQueryRows";
    const nextFields = {
      ...draft.fields,
      [fieldName]: [...draft.fields[fieldName], row],
    };
    setFields(() => nextFields);
    if (kind === "expected" && trustValidationAttempted.current) {
      applyTrustValidation(nextFields);
    }
  };

  const changeQueryRow = (
    kind: "source" | "expected",
    id: string,
    field: "key" | "value",
    value: string,
  ) => {
    if (!draft) return;
    if (kind === "expected") trustDirty.current.query = true;
    const fieldName = kind === "source" ? "queryRows" : "expectedQueryRows";
    const nextFields = {
      ...draft.fields,
      [fieldName]: updateRow(draft.fields[fieldName], id, field, value),
    };
    setFields(() => nextFields);
    if (kind === "expected" && trustValidationAttempted.current) {
      applyTrustValidation(nextFields);
    }
  };

  const removeQueryRow = (kind: "source" | "expected", id: string) => {
    if (!draft) return;
    if (kind === "expected") trustDirty.current.query = true;
    const fieldName = kind === "source" ? "queryRows" : "expectedQueryRows";
    const nextFields = {
      ...draft.fields,
      [fieldName]: draft.fields[fieldName].filter((row) => row.id !== id),
    };
    setFields(() => nextFields);
    if (kind === "expected" && trustValidationAttempted.current) {
      applyTrustValidation(nextFields);
    }
  };

  const continueFromSource = () => {
    if (!draft) return;
    const validation = validateComposerSourceUrl(draft.fields.sourceUrl);
    if (!validation.valid) {
      setSourceError(validation.issue.message);
      return;
    }
    const derived = deriveTrustFromSourceUrl(draft.fields.sourceUrl);
    const derivedDraft = {
      ...draft,
      fields: {
        ...draft.fields,
        expectedHost: trustDirty.current.host
          ? draft.fields.expectedHost
          : derived.expectedHost,
        expectedPathPrefix: trustDirty.current.path
          ? draft.fields.expectedPathPrefix
          : derived.expectedPathPrefix,
        expectedQueryRows: trustDirty.current.query
          ? draft.fields.expectedQueryRows
          : queryRowsFromSource(draft.fields.queryRows, derived.expectedQueryRows),
      },
    };
    setSourceError("");
    goToStep("transform", derivedDraft);
  };

  const continueFromTrust = () => {
    if (!draft) return;
    trustValidationAttempted.current = true;
    if (!applyTrustValidation(draft.fields)) return;
    goToStep("submit");
  };

  const importManifest = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!draft) return;
    const input = event.currentTarget;
    const selected = input.files?.[0];
    if (!selected) return;
    try {
      if (selected.size > MAX_IMPORT_BYTES) throw new Error("oversized");
      const imported = importWeb2JsonManifestDraft({
        manifest: JSON.parse(await selected.text()) as unknown,
        updatedAt: new Date().toISOString(),
        createIdempotencyKey: draft.createIdempotencyKey,
      });
      trustDirty.current = { host: true, path: true, query: true };
      replaceDraft({ ...imported, step });
      setSourceError("");
      setHostError("");
      setPathError("");
      setQueryKeyErrors({});
      setImportError("");
    } catch {
      setImportError("Manifest is invalid and could not be imported. Use a Web2JsonManifestV1 JSON file.");
    } finally {
      input.value = "";
    }
  };

  const continueFromTransform = () => {
    if (!draft) return;
    const validation = validateComposerTransformFields({
      jq: draft.fields.jq,
      abiSignature: draft.fields.abiSignature,
    });
    if (!validation.valid) {
      setJqError(
        validation.issues.find(({ field }) => field === "jq")?.message ?? "",
      );
      setAbiError(
        validation.issues.find(({ field }) => field === "abiSignature")?.message ?? "",
      );
      return;
    }
    setJqError("");
    setAbiError("");
    const canonicalDraft = {
      ...draft,
      fields: {
        ...draft.fields,
        abiSignature: validation.canonicalAbiSignature,
      },
    };
    goToStep("trust", canonicalDraft);
  };

  const applyFinalizationIssues = (
    issues: readonly ComposerFinalizationIssue[],
  ) => {
    setSourceError(issues.find(({ field }) => field === "sourceUrl")?.message ?? "");
    setJqError(issues.find(({ field }) => field === "jq")?.message ?? "");
    setAbiError(issues.find(({ field }) => field === "abiSignature")?.message ?? "");
    setHostError(issues.find(({ field }) => field === "expectedHost")?.message ?? "");
    setPathError(
      issues.find(({ field }) => field === "expectedPathPrefix")?.message ?? "",
    );
  };

  const focusFirstInvalidField = (field: string) => {
    if (field === "sourceUrl" || field.startsWith("queryRows")) {
      goToStep("source");
      setFocusField("sourceUrl");
      return;
    }
    if (field === "jq" || field === "abiSignature") {
      goToStep("transform");
      setFocusField(field);
      return;
    }
    goToStep("trust");
  };

  const submitManifest = async () => {
    if (!draft || submissionPending.current) return;
    if (!projectToken) {
      onConnect();
      return;
    }

    const finalized = finalizeWeb2JsonManifestDraft(draft);
    if (!finalized.valid) {
      onManifestValidated("rejected");
      applyFinalizationIssues(finalized.issues);
      focusFirstInvalidField(finalized.issues[0]?.field ?? "sourceUrl");
      return;
    }

    onManifestValidated("accepted");
    submissionPending.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      if (!services.createRun) {
        throw new Error("Run creation service is unavailable");
      }
      const rawResult = await services.createRun({
        projectToken,
        manifest: finalized.manifest,
        idempotencyKey: draft.createIdempotencyKey,
      });
      const parsed = CreateRunResultV1Schema.safeParse(rawResult);
      if (!parsed.success) {
        throw new Error("Invalid create-run response contract");
      }
      draftStore.clear();
      const destination = `/runs/${encodeURIComponent(parsed.data.runId)}?step=preflight`;
      globalThis.history.pushState({}, "", destination);
      onRunCreated(parsed.data.runId);
    } catch {
      setSubmitError(
        "Run could not be created. Retry uses the same saved request identity.",
      );
      submissionPending.current = false;
      setSubmitting(false);
    }
  };

  const startFresh = () => {
    draftStore.clear();
    const fresh = blankDraft("source");
    setRestoreState("fresh");
    setStep("source");
    globalThis.history.replaceState({}, "", stepHref("source"));
    replaceDraft(fresh);
  };

  const discardAndStartTemplate = () => {
    draftStore.clear();
    const template = {
      ...createEthUsdComposerDraft({
        updatedAt: new Date().toISOString(),
        createIdempotencyKey: `composer_${randomUuid()}`,
      }),
      step: "source" as const,
    };
    setRestoreState("fresh");
    setStep("source");
    globalThis.history.replaceState({}, "", stepHref("source"));
    replaceDraft(template);
  };

  const preview = draft ? finalizeWeb2JsonManifestDraft(draft) : null;

  return (
    <main
      className="entry-layout new-run-entry"
      onChangeCapture={recordStartOnce}
      onClickCapture={recordStartOnce}
    >
      <header className="entry-heading">
        <div>
          <span className="section-label">Manifest Composer</span>
          <h1>New Web2Json run</h1>
          <p>Define one public source, its transform, and the URL invariants your consumer must enforce.</p>
        </div>
        <a className="composer-back" href="/runs"><ArrowLeft size={17} aria-hidden="true" />Back to runs</a>
      </header>

      <nav className="composer-steps" aria-label="Composer steps">
        {COMPOSER_STEPS.map((item, index) => (
          <a
            className={step === item ? "is-current" : ""}
            href={stepHref(item)}
            aria-current={step === item ? "step" : undefined}
            onClick={(event) => navigateStep(event, item)}
            key={item}
          >
            <span aria-hidden="true">{index + 1}</span>
            {displayStep(item)}
          </a>
        ))}
      </nav>

      {restoreState === "rejected" ? (
        <section className="composer-panel composer-recovery" aria-label="Draft recovery">
          <div className="composer-alert" role="alert">
            <strong>Saved draft could not be restored.</strong>
            <span>The local value was rejected as a whole. No partial fields were loaded.</span>
            <button className="entry-secondary" type="button" onClick={startFresh}>
              Start fresh
            </button>
          </div>
        </section>
      ) : null}

      {draft && restoreState === "restored" ? (
        <div className="composer-draft-notice" role="status">
          <div>
            <strong>Draft restored.</strong>
            <span>Your last local Composer step and edits are ready.</span>
          </div>
          {hasTemplate ? (
            <button className="entry-secondary" type="button" onClick={discardAndStartTemplate}>
              Discard restored draft and start ETH/USD
            </button>
          ) : null}
        </div>
      ) : null}

      {draft && storageUnavailable ? (
        <p className="composer-storage-note" role="status">
          Storage unavailable. Edits stay local to this tab and won&apos;t survive reload.
        </p>
      ) : null}

      {draft && step === "source" ? (
        <section className="composer-panel" aria-labelledby="composer-source-title">
          <div className="composer-panel-heading">
            <div>
              <span className="section-label">Step 1 · Source</span>
              <h2 id="composer-source-title">Choose the public response</h2>
              <p>Proofline accepts one secure GET source. The browser only records this request definition.</p>
            </div>
            <label className="composer-import">
              <FileArrowUp size={18} aria-hidden="true" />Import manifest
              <input
                aria-label="Import manifest"
                type="file"
                accept="application/json,.json"
                onChange={(event) => void importManifest(event)}
              />
            </label>
          </div>

          {importError ? <p className="composer-alert" role="alert">{importError}</p> : null}

          <div className="composer-form">
            <label className="composer-field composer-field-wide">
              <span>Source URL</span>
              <input
                ref={sourceRef}
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://data.example.org/public/data"
                value={draft.fields.sourceUrl}
                aria-invalid={sourceError ? "true" : undefined}
                aria-describedby={sourceError ? "source-url-error source-browser-note" : "source-browser-note"}
                onChange={(event) => {
                  setFields((fields) => ({ ...fields, sourceUrl: event.target.value }));
                  if (sourceError) setSourceError("");
                }}
              />
              {sourceError ? <span className="composer-error" id="source-url-error">{sourceError}</span> : null}
            </label>

            <QueryRows
              kind="source"
              rows={draft.fields.queryRows}
              onAdd={() => addQueryRow("source")}
              onChange={(id, field, value) => changeQueryRow("source", id, field, value)}
              onRemove={(id) => removeQueryRow("source", id)}
            />
          </div>

          <div className="composer-security-note" id="source-browser-note">
            <LockKey size={19} aria-hidden="true" />
            <div>
              <strong>No browser request</strong>
              <span>Remote access happens during server-side preflight after the run is persisted.</span>
            </div>
          </div>

          <div className="composer-actions">
            <button className="entry-text-button" type="button" onClick={onConnect}>Connect project</button>
            <button className="entry-primary" type="button" onClick={continueFromSource}>
              Continue to Transform <ArrowRight size={18} weight="bold" aria-hidden="true" />
            </button>
          </div>
        </section>
      ) : null}

      {draft && step === "transform" ? (
        <section className="composer-panel" aria-labelledby="composer-transform-title">
          <div className="composer-panel-heading">
            <div>
              <span className="section-label">Step 2 · Transform</span>
              <h2 id="composer-transform-title">Describe the deterministic result</h2>
              <p>Set the JQ projection and the official JSON ABI-parameter descriptor used by Web2Json.</p>
            </div>
            <span className="composer-local-badge">Client-side draft</span>
          </div>

          <div className="composer-form composer-transform-grid">
            <label className="composer-field composer-field-wide">
              <span>JQ transform</span>
              <textarea
                ref={jqRef}
                rows={4}
                spellCheck={false}
                value={draft.fields.jq}
                aria-invalid={jqError ? "true" : undefined}
                aria-describedby={jqError ? "composer-jq-error" : "composer-jq-help"}
                onChange={(event) => {
                  setFields((fields) => ({ ...fields, jq: event.target.value }));
                  if (jqError) setJqError("");
                }}
              />
              <small id="composer-jq-help">Evaluated remotely only after persisted preflight.</small>
              {jqError ? <span className="composer-error" id="composer-jq-error">{jqError}</span> : null}
            </label>

            <label className="composer-field composer-field-wide">
              <span>ABI signature</span>
              <textarea
                ref={abiRef}
                rows={7}
                spellCheck={false}
                value={draft.fields.abiSignature}
                aria-invalid={abiError ? "true" : undefined}
                aria-describedby={abiError ? "composer-abi-error" : "composer-abi-help"}
                onChange={(event) => {
                  setFields((fields) => ({ ...fields, abiSignature: event.target.value }));
                  if (abiError) setAbiError("");
                }}
              />
              <small id="composer-abi-help">One bounded JSON ABI-parameter descriptor, including tuple components when required.</small>
              {abiError ? <span className="composer-error" id="composer-abi-error">{abiError}</span> : null}
            </label>
          </div>

          {preview?.valid ? (
            <section className="composer-preview" aria-labelledby="composer-preview-title">
              <div>
                <h3 id="composer-preview-title">Canonical manifest preview</h3>
                <span>Local only · definition bytes, not remote evidence</span>
              </div>
              <pre aria-label="Canonical manifest preview — local only">{preview.canonicalJson}</pre>
            </section>
          ) : null}

          <div className="composer-actions">
            <a className="entry-secondary" href={stepHref("source")} onClick={(event) => navigateStep(event, "source")}>Back to Source</a>
            <button className="entry-primary" type="button" onClick={continueFromTransform}>
              Continue to Trust <ArrowRight size={18} weight="bold" aria-hidden="true" />
            </button>
          </div>
        </section>
      ) : null}

      {draft && step === "trust" ? (
        <section className="composer-panel" aria-labelledby="composer-trust-title">
          <div className="composer-panel-heading">
            <div>
              <span className="section-label">Step 3 · Trust</span>
              <h2 id="composer-trust-title">Pin the URL invariants</h2>
              <p>A valid proof is only trusted when the consumer also enforces where the response came from.</p>
            </div>
          </div>

          <div className="composer-form composer-trust-grid">
            <label className="composer-field">
              <span>Expected scheme</span>
              <input value={draft.fields.expectedScheme} readOnly />
              <small>HTTPS is required.</small>
            </label>
            <label className="composer-field">
              <span>Expected host</span>
              <input
                autoComplete="off"
                value={draft.fields.expectedHost}
                aria-invalid={hostError ? "true" : undefined}
                aria-describedby={hostError ? "expected-host-error" : undefined}
                onChange={(event) => {
                  trustDirty.current.host = true;
                  const nextFields = { ...draft.fields, expectedHost: event.target.value };
                  setFields(() => nextFields);
                  if (trustValidationAttempted.current) applyTrustValidation(nextFields);
                }}
                onBlur={() => {
                  const validation = validateComposerTrustFields(draft.fields);
                  setHostError(
                    validation.valid
                      ? ""
                      : validation.issues.find(({ field }) => field === "expectedHost")?.message ?? "",
                  );
                }}
              />
              {hostError ? <span className="composer-error" id="expected-host-error">{hostError}</span> : null}
            </label>
            <label className="composer-field composer-field-wide">
              <span>Expected path prefix</span>
              <input
                autoComplete="off"
                value={draft.fields.expectedPathPrefix}
                aria-invalid={pathError ? "true" : undefined}
                aria-describedby={pathError ? "expected-path-error" : undefined}
                onChange={(event) => {
                  trustDirty.current.path = true;
                  const nextFields = { ...draft.fields, expectedPathPrefix: event.target.value };
                  setFields(() => nextFields);
                  if (trustValidationAttempted.current) applyTrustValidation(nextFields);
                  else if (pathError) setPathError("");
                }}
                onBlur={() => {
                  const validation = validateComposerTrustFields(draft.fields);
                  setPathError(
                    validation.valid
                      ? ""
                      : validation.issues.find(({ field }) => field === "expectedPathPrefix")?.message ?? "",
                  );
                }}
              />
              {pathError ? <span className="composer-error" id="expected-path-error">{pathError}</span> : null}
            </label>
            <QueryRows
              kind="expected"
              rows={draft.fields.expectedQueryRows}
              keyErrors={queryKeyErrors}
              onAdd={() => addQueryRow("expected")}
              onChange={(id, field, value) => changeQueryRow("expected", id, field, value)}
              onRemove={(id) => removeQueryRow("expected", id)}
            />
          </div>

          <div className="composer-actions">
            <a className="entry-secondary" href={stepHref("source")} onClick={(event) => navigateStep(event, "source")}>Back to Source</a>
            <button className="entry-primary" type="button" onClick={continueFromTrust}>
              Continue to Submit <ArrowRight size={18} weight="bold" aria-hidden="true" />
            </button>
          </div>
        </section>
      ) : null}

      {draft && step === "submit" ? (
        <section className="composer-panel" aria-labelledby="composer-submit-title">
          <div className="composer-panel-heading">
            <div>
              <span className="section-label">Step 4 · Submit</span>
              <h2 id="composer-submit-title">Create the persisted preflight run</h2>
              <p>Choose the submission intent and fee ceiling. No wallet or relayer effect happens on this step.</p>
            </div>
          </div>

          <div className="composer-submit-grid">
            <label className="composer-field">
              <span>Submission mode</span>
              <select
                value={draft.fields.submissionMode}
                onChange={(event) => setFields((fields) => ({
                  ...fields,
                  submissionMode: event.target.value as Web2JsonManifestDraftV1["fields"]["submissionMode"],
                }))}
              >
                <option value="wallet">Wallet</option>
                <option value="relayer">Relayer</option>
                <option value="replay">Replay</option>
              </select>
              <small>Fixed in the manifest when the run is created.</small>
            </label>
            <label className="composer-field">
              <span>Fee cap · wei</span>
              <input
                inputMode="numeric"
                autoComplete="off"
                value={draft.fields.feeCapWei}
                onChange={(event) => {
                  const value = event.target.value;
                  if (/^\d*$/.test(value)) {
                    setFields((fields) => ({ ...fields, feeCapWei: value }));
                  }
                }}
              />
              <small>Canonical unsigned integer; replay may use zero.</small>
            </label>
          </div>

          <dl className="composer-submit-summary" aria-label="Run creation summary">
            <div><dt>Network</dt><dd>Coston2 · chain 114</dd></div>
            <div><dt>Source</dt><dd>{draft.fields.expectedHost || "Not valid yet"}</dd></div>
            <div><dt>Next result</dt><dd>Persisted preflight evidence</dd></div>
          </dl>

          {submitError ? <p className="composer-alert" role="alert">{submitError}</p> : null}

          <div className="composer-actions">
            <a className="entry-secondary" href={stepHref("trust")} onClick={(event) => navigateStep(event, "trust")}>Back to Trust</a>
            <button
              className="entry-primary"
              type="button"
              disabled={submitting}
              onClick={() => void submitManifest()}
            >
              {submitting
                ? "Creating preflight run…"
                : projectToken
                  ? "Create preflight run"
                  : "Connect project to create"}
              <ArrowRight size={18} weight="bold" aria-hidden="true" />
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
