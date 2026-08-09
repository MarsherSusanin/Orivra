import { ArrowRight, CheckCircle, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { CanonicalUrlAttackDemoSummaryV1 } from "@proofline/contracts";
import type {
  Web2JsonTemplateCatalogV1,
  Web2JsonTemplateSummaryV1,
} from "@proofline/contracts/templates";
import { createCanonicalUrlAttackDemoClient } from "../services/canonical-url-attack-demo-client";
import { createTemplateCatalogClient } from "../services/template-catalog-client";
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
            <a className="entry-secondary" href="/runs/new?step=source">Open blank Composer</a>
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
            <p>No verified persisted recording is available for this deployment. Proofline does not substitute a fixture or synthetic result.</p>
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
          <p>This Proofline route is not available in this build.</p>
          <div className="landing-actions">
            <a className="entry-primary" href="/">Go home</a>
            <a className="entry-secondary" href="/runs">Open runs</a>
          </div>
        </main>
      </div>
    </div>
  );
}

export function PublicLanding({ requests }: { requests: PublicLandingRequestRefs }) {
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
            <div>
              <span className="section-label">Coston2 · Web2Json consumer assurance</span>
              <h1 id="landing-title">Trust the intended URL, not only a valid proof.</h1>
              <p>Proofline verifies the consumer’s scheme, host, path, and query, then packages reproducible evidence and safe Solidity.</p>
              <div className="landing-actions">
                <a className="entry-primary" href="/templates">Browse templates</a>
                <a className="entry-secondary" href="/runs">Open runs</a>
              </div>
            </div>
            <ShieldCheck size={112} weight="thin" aria-hidden="true" />
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
        </main>
      </div>
    </div>
  );
}

export default PublicLanding;
