import { ArrowRight, CheckCircle, Code, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { CanonicalUrlAttackDemoSummaryV1, Web2JsonManifestDraftV1 } from "@proofline/contracts";
import type {
  Web2JsonTemplateCatalogV1,
  Web2JsonTemplateSummaryV1,
} from "@proofline/contracts/templates";
import { createCanonicalUrlAttackDemoClient } from "../services/canonical-url-attack-demo-client";
import { createTemplateCatalogClient } from "../services/template-catalog-client";
import {
  createLandingComposerDraft,
  previewLandingSourceUrl,
} from "../services/landing-composer-handoff";
import { Sidebar } from "./Sidebar";
import { TemplateCard } from "./TemplateCatalogSurface";
import { Topbar } from "./Topbar";

type CatalogState =
  | { status: "loading" }
  | { status: "ready"; template: Web2JsonTemplateSummaryV1 }
  | { status: "unavailable" };

type DemoState =
  | { status: "loading" }
  | { status: "ready"; summary: CanonicalUrlAttackDemoSummaryV1 }
  | { status: "unavailable" };

export type PublicLandingRequestRefs = {
  catalog: { current: Promise<Web2JsonTemplateCatalogV1> | null };
  demo: { current: Promise<CanonicalUrlAttackDemoSummaryV1> | null };
};

function randomUuid(): string {
  const value = globalThis.crypto?.randomUUID?.();
  if (value) return value;
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (marker) => {
    const random = Math.floor(Math.random() * 16);
    const nibble = marker === "x" ? random : (random & 0x3) | 0x8;
    return nibble.toString(16);
  });
}

type LandingPreview = ReturnType<typeof previewLandingSourceUrl>;

function VerificationStarter({
  onContinue,
}: {
  onContinue(draft: Web2JsonManifestDraftV1): void;
}) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [preview, setPreview] = useState<LandingPreview | null>(null);

  const submitPreview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPreview(previewLandingSourceUrl(sourceUrl));
  };

  const continueWithWallet = () => {
    const result = createLandingComposerDraft({
      sourceUrl,
      updatedAt: new Date().toISOString(),
      createIdempotencyKey: `composer_${randomUuid()}`,
    });
    setPreview(result.valid
      ? previewLandingSourceUrl(sourceUrl)
      : result);
    if (result.valid) onContinue(result.draft);
  };

  return (
    <div className="landing-starter">
      <form className="landing-starter-form" onSubmit={submitPreview} noValidate>
        <label htmlFor="landing-source-url">Public HTTPS endpoint</label>
        <div className="landing-source-control">
          <input
            id="landing-source-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://api.example.com/prices/eth?currency=USD"
            value={sourceUrl}
            aria-describedby="landing-source-note"
            aria-invalid={preview?.valid === false ? "true" : undefined}
            onChange={(event) => {
              setSourceUrl(event.target.value);
              setPreview(null);
            }}
          />
          <button className="entry-primary" type="submit">Preview trust boundary</button>
        </div>
        <p id="landing-source-note">Parsed locally. Orivra will not request this endpoint from your browser.</p>
        {preview?.valid === false ? (
          <p className="landing-source-error" role="alert">{preview.issue.message}</p>
        ) : null}
      </form>

      <section className="landing-trust-preview" aria-label="Trust boundary preview">
        <header>
          <span className="section-label">Consumer invariant preview</span>
          <span className={preview?.valid ? "is-ready" : ""}>
            {preview?.valid ? "Boundary derived" : "Awaiting endpoint"}
          </span>
        </header>
        {preview?.valid ? (
          <>
            <dl>
              <div><dt>Scheme</dt><dd>{preview.trust.expectedScheme}</dd></div>
              <div><dt>Host</dt><dd>{preview.trust.expectedHost}</dd></div>
              <div><dt>Path prefix</dt><dd>{preview.trust.expectedPathPrefix}</dd></div>
              <div>
                <dt>Required query</dt>
                <dd>{preview.trust.expectedQueryRows.length > 0
                  ? preview.trust.expectedQueryRows.map(({ key, value }) => `${key}=${value}`).join(" · ")
                  : "None"}</dd>
              </div>
            </dl>
            <button className="entry-primary landing-wallet-continue" type="button" onClick={continueWithWallet}>
              Continue with wallet <ArrowRight size={17} aria-hidden="true" />
            </button>
          </>
        ) : (
          <div className="landing-preview-empty">
            <Code size={34} aria-hidden="true" />
            <p>Enter the exact endpoint your generated consumer should accept.</p>
          </div>
        )}
      </section>
    </div>
  );
}

const journey = [
  ["Proof available", "Shown only after the persisted proof stage completes."],
  ["Verify consumer", "Check scheme, host, path, and query invariants."],
  ["Generate safe consumer", "Turn evidence-backed findings into deterministic Solidity."],
  ["Open integration package", "Export the receipt, bundle, manifest, and consumer together."],
] as const;

function recordedDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Recorded time unavailable";
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  });
}

function FeaturedTemplate({ state }: { state: CatalogState }) {
  return (
    <section className="landing-panel landing-featured" aria-labelledby="landing-featured-title">
      <header className="landing-panel-heading">
        <span className="section-label">Built-in Web2Json manifests</span>
        <h2 id="landing-featured-title">Featured starting point</h2>
      </header>
      {state.status === "loading" ? (
        <div className="landing-state" role="status">
          <span className="entry-state-spinner" aria-hidden="true" />
          <p>Loading featured template…</p>
        </div>
      ) : state.status === "unavailable" ? (
        <div className="landing-state is-unavailable">
          <WarningCircle size={28} aria-hidden="true" />
          <div>
            <h3>Featured template unavailable</h3>
            <p>The built-in catalog could not be verified. No template manifest was substituted.</p>
            <a className="entry-secondary" href="/app/runs/new?step=source">Open blank Composer</a>
          </div>
        </div>
      ) : (
        <TemplateCard template={state.template} showDetails={false} />
      )}
    </section>
  );
}

function DemoEvidence({ state }: { state: DemoState }) {
  return (
    <section className="landing-panel landing-demo" aria-labelledby="landing-demo-title">
      <header className="landing-panel-heading">
        <span className="section-label">Canonical URL attack</span>
        <h2 id="landing-demo-title">
          {state.status === "ready" ? state.summary.statement : "Canonical URL attack"}
        </h2>
      </header>
      {state.status === "loading" ? (
        <div className="landing-state" role="status">
          <span className="entry-state-spinner" aria-hidden="true" />
          <p>Checking canonical attack evidence…</p>
        </div>
      ) : state.status === "unavailable" ? (
        <div className="landing-state is-unavailable">
          <WarningCircle size={28} aria-hidden="true" />
          <div>
            <h3>Verified recording unavailable</h3>
            <p>No verified persisted recording is available for this deployment. Orivra does not substitute a fixture or synthetic result.</p>
            <a className="entry-secondary" href="/demo/canonical-url">View availability details</a>
          </div>
        </div>
      ) : (
        <div className="landing-demo-ready">
          <div className="landing-demo-status">
            <CheckCircle size={22} weight="fill" aria-hidden="true" />
            <strong>Persisted evidence available</strong>
          </div>
          <dl>
            <div><dt>Recorded</dt><dd>{recordedDate(state.summary.recording.recordedAt)}</dd></div>
            <div><dt>Runs</dt><dd>{Object.keys(state.summary.runs).length}</dd></div>
            <div><dt>Outcomes</dt><dd>{state.summary.outcomes.length}</dd></div>
          </dl>
          <a className="entry-secondary" href="/demo/canonical-url">
            Inspect evidence <ArrowRight size={17} aria-hidden="true" />
          </a>
        </div>
      )}
    </section>
  );
}

export function PageUnavailable() {
  return (
    <div className="app-shell">
      <Sidebar active="" />
      <div className="shell-main entry-shell-main">
        <Topbar title="Page unavailable" attestationType="Web2Json" mode="new" />
        <main className="landing-unavailable">
          <WarningCircle size={36} aria-hidden="true" />
          <h1>Page unavailable</h1>
          <p>This Orivra route is not available in this build.</p>
          <div className="landing-actions">
            <a className="entry-primary" href="/">Go home</a>
            <a className="entry-secondary" href="/app/runs">Open runs</a>
          </div>
        </main>
      </div>
    </div>
  );
}

export function PublicLanding({
  requests,
  onContinue,
}: {
  requests: PublicLandingRequestRefs;
  onContinue(draft: Web2JsonManifestDraftV1): void;
}) {
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [demo, setDemo] = useState<DemoState>({ status: "loading" });
  const catalogClient = useMemo(
    () => createTemplateCatalogClient({ fetch: globalThis.fetch }),
    [],
  );
  const demoClient = useMemo(
    () => createCanonicalUrlAttackDemoClient({ fetch: globalThis.fetch }),
    [],
  );

  useEffect(() => {
    let active = true;
    requests.catalog.current ??= catalogClient.listTemplates();
    requests.demo.current ??= demoClient.getSummary();

    void requests.catalog.current.then(
      (value) => {
        const featured = value.templates.find((template) => template.featured === true);
        if (active) setCatalog(featured
          ? { status: "ready", template: featured }
          : { status: "unavailable" });
      },
      () => { if (active) setCatalog({ status: "unavailable" }); },
    );
    void requests.demo.current.then(
      (summary) => { if (active) setDemo({ status: "ready", summary }); },
      () => { if (active) setDemo({ status: "unavailable" }); },
    );
    return () => { active = false; };
  }, [catalogClient, demoClient, requests]);

  return (
    <div className="app-shell">
      <Sidebar active="" />
      <div className="shell-main entry-shell-main">
        <Topbar title="Overview" attestationType="Web2Json" mode="overview" />
        <main className="landing-page">
          <section className="landing-hero" aria-labelledby="landing-title">
            <div className="landing-hero-copy">
              <span className="section-label">Coston2 · Web2Json consumer assurance</span>
              <h1 id="landing-title">Verify what your Web2Json consumer actually trusts.</h1>
              <p>A valid proof is not enough when the consumer accepts the wrong endpoint. Preview the exact URL boundary, then turn it into persisted evidence and safe Solidity.</p>
              <div className="landing-actions">
                <a className="entry-secondary" href="/templates">Use a manifest template</a>
                <a className="entry-secondary" href="/app/runs">Open runs</a>
              </div>
            </div>
            <VerificationStarter onContinue={onContinue} />
          </section>

          <section className="landing-trust-gap" aria-labelledby="landing-trust-gap-title">
            <ShieldCheck size={45} weight="thin" aria-hidden="true" />
            <div>
              <span className="section-label">The trust gap</span>
              <h2 id="landing-trust-gap-title">A valid proof can still trust the wrong URL.</h2>
              <p>Orivra checks the consumer boundary against the intended scheme, host, path and required query before it offers consumer generation or export.</p>
            </div>
            <code>proof.completed → consumer.verified → bundle.exported</code>
          </section>

          <section className="landing-journey" aria-labelledby="landing-journey-title">
            <header className="landing-panel-heading">
              <span className="section-label">Persisted workflow</span>
              <h2 id="landing-journey-title">From proof to integration evidence</h2>
            </header>
            <ol>
              {journey.map(([title, description], index) => (
                <li key={title}>
                  <span className="landing-step-number" aria-hidden="true">{index + 1}</span>
                  <div><strong>{title}</strong><p>{description}</p></div>
                </li>
              ))}
            </ol>
          </section>

          <div className="landing-public-grid">
            <FeaturedTemplate state={catalog} />
            <DemoEvidence state={demo} />
          </div>

          <section className="landing-output" aria-labelledby="landing-output-title">
            <header className="landing-panel-heading">
              <span className="section-label">One reproducible package</span>
              <h2 id="landing-output-title">Evidence your team can inspect and integrate</h2>
            </header>
            <div>
              <article><strong>Consumer evidence</strong><p>Persisted invariant checks bound to one completed proof.</p></article>
              <article><strong>Safe Solidity</strong><p>Deterministic consumer output generated only from verified evidence.</p></article>
              <article><strong>Integration package</strong><p>Manifest, receipt, consumer and replayable bundle exported together.</p></article>
            </div>
          </section>

          <section className="landing-wallet-security" aria-labelledby="landing-wallet-title">
            <div>
              <span className="section-label">Wallet security</span>
              <h2 id="landing-wallet-title">Sign in, don’t hand over keys.</h2>
              <p>Orivra uses SIWE with compatible injected EVM wallets. Sign-in does not send a transaction or charge gas; relayer keys never reach the browser.</p>
            </div>
            <a className="entry-primary" href="#landing-source-url">Verify an endpoint</a>
          </section>
        </main>
      </div>
    </div>
  );
}

export default PublicLanding;
