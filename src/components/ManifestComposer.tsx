import {
  ArrowLeft,
  ArrowRight,
  FileArrowUp,
  FileCode,
  LockKey,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import type { ChangeEvent, MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type {
  ComposerStepV1,
  Web2JsonDraftQueryRowV1,
  Web2JsonManifestDraftV1,
} from "../../packages/contracts/src";
import {
  createEthUsdComposerDraft,
  deriveTrustFromSourceUrl,
  importWeb2JsonManifestDraft,
  validateComposerTrustFields,
  validateComposerSourceUrl,
} from "../../packages/domain/src";

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

function blankDraft(): Web2JsonManifestDraftV1 {
  return {
    version: "1",
    step: "source",
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

function initialDraft(): Web2JsonManifestDraftV1 {
  const base = {
    updatedAt: new Date().toISOString(),
    createIdempotencyKey: `composer_${randomUuid()}`,
  };
  const template = new URLSearchParams(globalThis.location?.search ?? "").get("template");
  return template === "eth-usd" ? createEthUsdComposerDraft(base) : blankDraft();
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

function UnavailableStep({ step }: { step: "transform" | "submit" }) {
  return (
    <section className="composer-panel composer-unavailable" aria-labelledby="composer-unavailable-title">
      <span className="entry-state-icon" aria-hidden="true"><FileCode size={34} /></span>
      <div>
        <span className="section-label">Slice 015B</span>
        <h2 id="composer-unavailable-title">{displayStep(step)} is not available yet</h2>
        <p>
          {step === "transform"
            ? "JQ, ABI signature, canonical preview, and local draft recovery arrive in the next Composer slice."
            : "Run creation remains locked until Transform and the final manifest validation are implemented."}
        </p>
      </div>
    </section>
  );
}

export function ManifestComposer({
  onConnect,
  onStart,
}: {
  onConnect(): void;
  onStart(): void;
}) {
  const [step, setStep] = useState(stepFromLocation);
  const [draft, setDraft] = useState(initialDraft);
  const [sourceError, setSourceError] = useState("");
  const [hostError, setHostError] = useState("");
  const [pathError, setPathError] = useState("");
  const [queryKeyErrors, setQueryKeyErrors] = useState<Record<string, string>>({});
  const [importError, setImportError] = useState("");
  const trustDirty = useRef<TrustDirtyState>({ ...CLEAN_TRUST });
  const trustValidationAttempted = useRef(false);
  const startRecorded = useRef(false);

  const recordStartOnce = () => {
    if (startRecorded.current) return;
    startRecorded.current = true;
    onStart();
  };

  useEffect(() => {
    const restoreStep = () => {
      const restored = stepFromLocation();
      const requested = new URLSearchParams(globalThis.location.search).get("step");
      if (requested !== restored) {
        globalThis.history.replaceState({}, "", stepHref(restored));
      }
      setStep(restored);
    };
    restoreStep();
    globalThis.addEventListener("popstate", restoreStep);
    return () => globalThis.removeEventListener("popstate", restoreStep);
  }, []);

  const setFields = (
    updater: (fields: Web2JsonManifestDraftV1["fields"]) => Web2JsonManifestDraftV1["fields"],
  ) => {
    setDraft((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      fields: updater(current.fields),
    }));
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
    globalThis.history.pushState({}, "", stepHref(next));
    setDraft((current) => ({ ...current, step: next, updatedAt: new Date().toISOString() }));
    setStep(next);
  };

  const goToStep = (next: ComposerStepV1) => {
    globalThis.history.pushState({}, "", stepHref(next));
    setDraft((current) => ({ ...current, step: next, updatedAt: new Date().toISOString() }));
    setStep(next);
  };

  const addQueryRow = (kind: "source" | "expected") => {
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
    const validation = validateComposerSourceUrl(draft.fields.sourceUrl);
    if (!validation.valid) {
      setSourceError(validation.issue.message);
      return;
    }
    const derived = deriveTrustFromSourceUrl(draft.fields.sourceUrl);
    setFields((fields) => ({
      ...fields,
      expectedHost: trustDirty.current.host ? fields.expectedHost : derived.expectedHost,
      expectedPathPrefix: trustDirty.current.path
        ? fields.expectedPathPrefix
        : derived.expectedPathPrefix,
      expectedQueryRows: trustDirty.current.query
        ? fields.expectedQueryRows
        : queryRowsFromSource(fields.queryRows, derived.expectedQueryRows),
    }));
    setSourceError("");
    goToStep("transform");
  };

  const continueFromTrust = () => {
    trustValidationAttempted.current = true;
    if (!applyTrustValidation(draft.fields)) return;
    goToStep("submit");
  };

  const importManifest = async (event: ChangeEvent<HTMLInputElement>) => {
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
      setDraft({ ...imported, step });
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

      {step === "source" ? (
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

      {step === "trust" ? (
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

      {step === "transform" || step === "submit" ? <UnavailableStep step={step} /> : null}
    </main>
  );
}
