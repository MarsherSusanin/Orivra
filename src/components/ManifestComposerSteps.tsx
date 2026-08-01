import {
  ArrowRight,
  FileArrowUp,
  LockKey,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import type {
  ChangeEvent,
  MouseEvent,
  RefObject,
} from "react";
import type {
  ComposerStepV1,
  Web2JsonDraftQueryRowV1,
  Web2JsonManifestDraftV1,
} from "../../packages/contracts/src";

export const COMPOSER_STEPS: readonly ComposerStepV1[] = [
  "source",
  "transform",
  "trust",
  "submit",
];

type ComposerFields = Web2JsonManifestDraftV1["fields"];
type QueryKind = "source" | "expected";
type QueryField = "key" | "value";
type StepNavigate = (
  event: MouseEvent<HTMLAnchorElement>,
  next: ComposerStepV1,
) => void;

type QueryHandlers = {
  onAddQuery(kind: QueryKind): void;
  onChangeQuery(
    kind: QueryKind,
    id: string,
    field: QueryField,
    value: string,
  ): void;
  onRemoveQuery(kind: QueryKind, id: string): void;
};

function displayStep(step: ComposerStepV1): string {
  return step.charAt(0).toUpperCase() + step.slice(1);
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
  kind: QueryKind;
  keyErrors?: Readonly<Record<string, string>>;
  onAdd(): void;
  onChange(id: string, field: QueryField, value: string): void;
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
                  aria-describedby={keyErrors?.[row.id]
                    ? `query-key-error-${row.id}`
                    : undefined}
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
                aria-label={expected
                  ? "Remove expected query"
                  : "Remove query parameter"}
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

export function ComposerStepsNav({
  step,
  stepHref,
  onNavigate,
}: {
  step: ComposerStepV1;
  stepHref(step: ComposerStepV1): string;
  onNavigate: StepNavigate;
}) {
  return (
    <nav className="composer-steps" aria-label="Composer steps">
      {COMPOSER_STEPS.map((item, index) => (
        <a
          className={step === item ? "is-current" : ""}
          href={stepHref(item)}
          aria-current={step === item ? "step" : undefined}
          onClick={(event) => onNavigate(event, item)}
          key={item}
        >
          <span aria-hidden="true">{index + 1}</span>
          {displayStep(item)}
        </a>
      ))}
    </nav>
  );
}

export function ComposerSourceStep({
  fields,
  sourceError,
  importError,
  sourceRef,
  onImportManifest,
  onSourceChange,
  onConnect,
  onContinue,
  onAddQuery,
  onChangeQuery,
  onRemoveQuery,
}: {
  fields: ComposerFields;
  sourceError: string;
  importError: string;
  sourceRef: RefObject<HTMLInputElement | null>;
  onImportManifest(event: ChangeEvent<HTMLInputElement>): void;
  onSourceChange(value: string): void;
  onConnect(): void;
  onContinue(): void;
} & QueryHandlers) {
  return (
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
            onChange={onImportManifest}
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
            value={fields.sourceUrl}
            aria-invalid={sourceError ? "true" : undefined}
            aria-describedby={sourceError
              ? "source-url-error source-browser-note"
              : "source-browser-note"}
            onChange={(event) => onSourceChange(event.target.value)}
          />
          {sourceError ? (
            <span className="composer-error" id="source-url-error">
              {sourceError}
            </span>
          ) : null}
        </label>

        <QueryRows
          kind="source"
          rows={fields.queryRows}
          onAdd={() => onAddQuery("source")}
          onChange={(id, field, value) =>
            onChangeQuery("source", id, field, value)}
          onRemove={(id) => onRemoveQuery("source", id)}
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
        <button className="entry-text-button" type="button" onClick={onConnect}>
          Connect project
        </button>
        <button className="entry-primary" type="button" onClick={onContinue}>
          Continue to Transform <ArrowRight size={18} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

export function ComposerTransformStep({
  fields,
  jqError,
  abiError,
  jqRef,
  abiRef,
  canonicalPreview,
  stepHref,
  onNavigate,
  onJqChange,
  onAbiChange,
  onContinue,
}: {
  fields: ComposerFields;
  jqError: string;
  abiError: string;
  jqRef: RefObject<HTMLTextAreaElement | null>;
  abiRef: RefObject<HTMLTextAreaElement | null>;
  canonicalPreview?: string;
  stepHref(step: ComposerStepV1): string;
  onNavigate: StepNavigate;
  onJqChange(value: string): void;
  onAbiChange(value: string): void;
  onContinue(): void;
}) {
  return (
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
            value={fields.jq}
            aria-invalid={jqError ? "true" : undefined}
            aria-describedby={jqError ? "composer-jq-error" : "composer-jq-help"}
            onChange={(event) => onJqChange(event.target.value)}
          />
          <small id="composer-jq-help">Evaluated remotely only after persisted preflight.</small>
          {jqError ? (
            <span className="composer-error" id="composer-jq-error">{jqError}</span>
          ) : null}
        </label>

        <label className="composer-field composer-field-wide">
          <span>ABI signature</span>
          <textarea
            ref={abiRef}
            rows={7}
            spellCheck={false}
            value={fields.abiSignature}
            aria-invalid={abiError ? "true" : undefined}
            aria-describedby={abiError ? "composer-abi-error" : "composer-abi-help"}
            onChange={(event) => onAbiChange(event.target.value)}
          />
          <small id="composer-abi-help">One bounded JSON ABI-parameter descriptor, including tuple components when required.</small>
          {abiError ? (
            <span className="composer-error" id="composer-abi-error">{abiError}</span>
          ) : null}
        </label>
      </div>

      {canonicalPreview ? (
        <section className="composer-preview" aria-labelledby="composer-preview-title">
          <div>
            <h3 id="composer-preview-title">Canonical manifest preview</h3>
            <span>Local only · definition bytes, not remote evidence</span>
          </div>
          <pre aria-label="Canonical manifest preview — local only">{canonicalPreview}</pre>
        </section>
      ) : null}

      <div className="composer-actions">
        <a
          className="entry-secondary"
          href={stepHref("source")}
          onClick={(event) => onNavigate(event, "source")}
        >
          Back to Source
        </a>
        <button className="entry-primary" type="button" onClick={onContinue}>
          Continue to Trust <ArrowRight size={18} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

export function ComposerTrustStep({
  fields,
  hostError,
  pathError,
  queryKeyErrors,
  stepHref,
  onNavigate,
  onHostChange,
  onHostBlur,
  onPathChange,
  onPathBlur,
  onContinue,
  onAddQuery,
  onChangeQuery,
  onRemoveQuery,
}: {
  fields: ComposerFields;
  hostError: string;
  pathError: string;
  queryKeyErrors: Readonly<Record<string, string>>;
  stepHref(step: ComposerStepV1): string;
  onNavigate: StepNavigate;
  onHostChange(value: string): void;
  onHostBlur(): void;
  onPathChange(value: string): void;
  onPathBlur(): void;
  onContinue(): void;
} & QueryHandlers) {
  return (
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
          <input value={fields.expectedScheme} readOnly />
          <small>HTTPS is required.</small>
        </label>
        <label className="composer-field">
          <span>Expected host</span>
          <input
            autoComplete="off"
            value={fields.expectedHost}
            aria-invalid={hostError ? "true" : undefined}
            aria-describedby={hostError ? "expected-host-error" : undefined}
            onChange={(event) => onHostChange(event.target.value)}
            onBlur={onHostBlur}
          />
          {hostError ? (
            <span className="composer-error" id="expected-host-error">{hostError}</span>
          ) : null}
        </label>
        <label className="composer-field composer-field-wide">
          <span>Expected path prefix</span>
          <input
            autoComplete="off"
            value={fields.expectedPathPrefix}
            aria-invalid={pathError ? "true" : undefined}
            aria-describedby={pathError ? "expected-path-error" : undefined}
            onChange={(event) => onPathChange(event.target.value)}
            onBlur={onPathBlur}
          />
          {pathError ? (
            <span className="composer-error" id="expected-path-error">{pathError}</span>
          ) : null}
        </label>
        <QueryRows
          kind="expected"
          rows={fields.expectedQueryRows}
          keyErrors={queryKeyErrors}
          onAdd={() => onAddQuery("expected")}
          onChange={(id, field, value) =>
            onChangeQuery("expected", id, field, value)}
          onRemove={(id) => onRemoveQuery("expected", id)}
        />
      </div>

      <div className="composer-actions">
        <a
          className="entry-secondary"
          href={stepHref("source")}
          onClick={(event) => onNavigate(event, "source")}
        >
          Back to Source
        </a>
        <button className="entry-primary" type="button" onClick={onContinue}>
          Continue to Submit <ArrowRight size={18} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

export function ComposerSubmitStep({
  fields,
  projectConnected,
  submitting,
  submitError,
  stepHref,
  onNavigate,
  onSubmissionModeChange,
  onFeeCapChange,
  onSubmit,
}: {
  fields: ComposerFields;
  projectConnected: boolean;
  submitting: boolean;
  submitError: string;
  stepHref(step: ComposerStepV1): string;
  onNavigate: StepNavigate;
  onSubmissionModeChange(value: ComposerFields["submissionMode"]): void;
  onFeeCapChange(value: string): void;
  onSubmit(): void;
}) {
  return (
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
            value={fields.submissionMode}
            onChange={(event) => onSubmissionModeChange(
              event.target.value as ComposerFields["submissionMode"],
            )}
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
            value={fields.feeCapWei}
            onChange={(event) => onFeeCapChange(event.target.value)}
          />
          <small>Canonical unsigned integer; replay may use zero.</small>
        </label>
      </div>

      <dl className="composer-submit-summary" aria-label="Run creation summary">
        <div><dt>Network</dt><dd>Coston2 · chain 114</dd></div>
        <div><dt>Source</dt><dd>{fields.expectedHost || "Not valid yet"}</dd></div>
        <div><dt>Next result</dt><dd>Persisted preflight evidence</dd></div>
      </dl>

      {submitError ? <p className="composer-alert" role="alert">{submitError}</p> : null}

      <div className="composer-actions">
        <a
          className="entry-secondary"
          href={stepHref("trust")}
          onClick={(event) => onNavigate(event, "trust")}
        >
          Back to Trust
        </a>
        <button
          className="entry-primary"
          type="button"
          disabled={submitting}
          onClick={onSubmit}
        >
          {submitting
            ? "Creating preflight run…"
            : projectConnected
              ? "Create preflight run"
              : "Connect project to create"}
          <ArrowRight size={18} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
