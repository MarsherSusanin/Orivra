import { ArrowLeft } from "@phosphor-icons/react";
import type { ChangeEvent, MouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CreateRunResultV1Schema,
  type ComposerStepV1,
  type Web2JsonDraftQueryRowV1,
  type Web2JsonManifestDraftV1,
  type Web2JsonManifestV1,
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
import {
  consumeReplacementComposerDraft,
  createComposerDraftStore,
} from "../services/composer-draft-store";
import type { RunSurfaceServices } from "../services/run-surface";
import {
  COMPOSER_STEPS,
  ComposerSourceStep,
  ComposerStepsNav,
  ComposerSubmitStep,
  ComposerTransformStep,
  ComposerTrustStep,
} from "./ManifestComposerSteps";

const MAX_IMPORT_BYTES = 64 * 1024;

type TrustDirtyState = {
  host: boolean;
  path: boolean;
  query: boolean;
};

type PendingCreateIntent = {
  manifest: Web2JsonManifestV1;
  idempotencyKey: string;
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

function browserSessionDraftStorage() {
  try {
    const storage = globalThis.sessionStorage;
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

function locationStep():
  | { state: "absent" | "invalid" }
  | { state: "valid"; step: ComposerStepV1 } {
  const value = new URLSearchParams(globalThis.location?.search ?? "").get("step");
  if (value === null) return { state: "absent" };
  return COMPOSER_STEPS.includes(value as ComposerStepV1)
    ? { state: "valid", step: value as ComposerStepV1 }
    : { state: "invalid" };
}

function stepFromLocation(): ComposerStepV1 {
  const requested = locationStep();
  return requested.state === "valid" ? requested.step : "source";
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
    const sourceRunId = new URLSearchParams(globalThis.location?.search ?? "").get("from");
    const replacement = sourceRunId
      ? consumeReplacementComposerDraft(browserSessionDraftStorage(), sourceRunId)
      : { state: "empty" as const };
    if (replacement.state === "restored") {
      draftStore.save(replacement.draft);
    }
    const loaded = replacement.state === "restored" ? replacement : draftStore.load();
    const requested = locationStep();
    const requestedStep = requested.state === "valid"
      ? requested.step
      : "source";
    if (loaded.state === "restored") {
      const restoredStep = requested.state === "absent"
        ? loaded.draft.step
        : requestedStep;
      return {
        draft: {
          ...loaded.draft,
          step: restoredStep,
        } as Web2JsonManifestDraftV1 | null,
        step: restoredStep,
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
  const pendingCreateIntent = useRef<PendingCreateIntent | null>(null);
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
    const requested = locationStep();
    if (requested.state !== "valid" || requested.step !== startup.step) {
      globalThis.history.replaceState({}, "", stepHref(startup.step));
    }

    const restoreStep = () => {
      const next = stepFromLocation();
      setStep(next);
      setDraft((current) => current && current.step !== next
        ? { ...current, step: next }
        : current);
    };
    globalThis.addEventListener("popstate", restoreStep);
    return () => globalThis.removeEventListener("popstate", restoreStep);
  }, [startup.step]);

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

  const createRunFromIntent = useCallback(async (intent: PendingCreateIntent) => {
    if (!projectToken || submissionPending.current) return;
    submissionPending.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      if (!services.createRun) {
        throw new Error("Run creation service is unavailable");
      }
      const rawResult = await services.createRun({
        projectToken,
        manifest: intent.manifest,
        idempotencyKey: intent.idempotencyKey,
      });
      const parsed = CreateRunResultV1Schema.safeParse(rawResult);
      if (!parsed.success) {
        throw new Error("Invalid create-run response contract");
      }
      pendingCreateIntent.current = null;
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
  }, [draftStore, onRunCreated, projectToken, services]);

  useEffect(() => {
    const intent = pendingCreateIntent.current;
    if (!projectToken || !intent || submissionPending.current) return;
    void createRunFromIntent(intent);
  }, [createRunFromIntent, projectToken]);

  const submitManifest = () => {
    if (!draft || submissionPending.current) return;
    const existingIntent = pendingCreateIntent.current;
    if (existingIntent) {
      if (projectToken) void createRunFromIntent(existingIntent);
      else onConnect();
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
    const intent = {
      manifest: structuredClone(finalized.manifest),
      idempotencyKey: draft.createIdempotencyKey,
    } satisfies PendingCreateIntent;
    pendingCreateIntent.current = intent;
    if (!projectToken) {
      onConnect();
      return;
    }
    void createRunFromIntent(intent);
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

      <ComposerStepsNav
        step={step}
        stepHref={stepHref}
        onNavigate={navigateStep}
      />

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
        <ComposerSourceStep
          fields={draft.fields}
          sourceError={sourceError}
          importError={importError}
          sourceRef={sourceRef}
          onImportManifest={(event) => void importManifest(event)}
          onSourceChange={(value) => {
            setFields((fields) => ({ ...fields, sourceUrl: value }));
            if (sourceError) setSourceError("");
          }}
          onConnect={onConnect}
          onContinue={continueFromSource}
          onAddQuery={addQueryRow}
          onChangeQuery={changeQueryRow}
          onRemoveQuery={removeQueryRow}
        />
      ) : null}

      {draft && step === "transform" ? (
        <ComposerTransformStep
          fields={draft.fields}
          jqError={jqError}
          abiError={abiError}
          jqRef={jqRef}
          abiRef={abiRef}
          canonicalPreview={preview?.valid ? preview.canonicalJson : undefined}
          stepHref={stepHref}
          onNavigate={navigateStep}
          onJqChange={(value) => {
            setFields((fields) => ({ ...fields, jq: value }));
            if (jqError) setJqError("");
          }}
          onAbiChange={(value) => {
            setFields((fields) => ({ ...fields, abiSignature: value }));
            if (abiError) setAbiError("");
          }}
          onContinue={continueFromTransform}
        />
      ) : null}

      {draft && step === "trust" ? (
        <ComposerTrustStep
          fields={draft.fields}
          hostError={hostError}
          pathError={pathError}
          queryKeyErrors={queryKeyErrors}
          stepHref={stepHref}
          onNavigate={navigateStep}
          onHostChange={(value) => {
            trustDirty.current.host = true;
            const nextFields = { ...draft.fields, expectedHost: value };
            setFields(() => nextFields);
            if (trustValidationAttempted.current) applyTrustValidation(nextFields);
          }}
          onHostBlur={() => {
            const validation = validateComposerTrustFields(draft.fields);
            setHostError(
              validation.valid
                ? ""
                : validation.issues.find(({ field }) =>
                  field === "expectedHost")?.message ?? "",
            );
          }}
          onPathChange={(value) => {
            trustDirty.current.path = true;
            const nextFields = { ...draft.fields, expectedPathPrefix: value };
            setFields(() => nextFields);
            if (trustValidationAttempted.current) applyTrustValidation(nextFields);
            else if (pathError) setPathError("");
          }}
          onPathBlur={() => {
            const validation = validateComposerTrustFields(draft.fields);
            setPathError(
              validation.valid
                ? ""
                : validation.issues.find(({ field }) =>
                  field === "expectedPathPrefix")?.message ?? "",
            );
          }}
          onContinue={continueFromTrust}
          onAddQuery={addQueryRow}
          onChangeQuery={changeQueryRow}
          onRemoveQuery={removeQueryRow}
        />
      ) : null}

      {draft && step === "submit" ? (
        <ComposerSubmitStep
          fields={draft.fields}
          projectConnected={Boolean(projectToken)}
          submitting={submitting}
          submitError={submitError}
          stepHref={stepHref}
          onNavigate={navigateStep}
          onSubmissionModeChange={(submissionMode) => setFields((fields) => ({
            ...fields,
            submissionMode,
          }))}
          onFeeCapChange={(value) => {
            if (/^\d*$/.test(value)) {
              setFields((fields) => ({ ...fields, feeCapWei: value }));
            }
          }}
          onSubmit={() => void submitManifest()}
        />
      ) : null}
    </main>
  );
}
