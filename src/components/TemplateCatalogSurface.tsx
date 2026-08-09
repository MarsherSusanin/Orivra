import { ArrowLeft, ArrowRight, CloudSun, CurrencyEth } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type {
  Web2JsonTemplateCatalogV1,
  Web2JsonTemplateDetailV1,
  Web2JsonTemplateSummaryV1,
} from "@proofline/contracts/templates";
import {
  createTemplateCatalogClient,
  type TemplateCatalogClient,
} from "../services/template-catalog-client";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

type TemplateState<T> =
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "unavailable" };

function useTemplateClient(): TemplateCatalogClient {
  return useMemo(
    () => createTemplateCatalogClient({ fetch: globalThis.fetch }),
    [],
  );
}

function TemplateCard({ template }: { template: Web2JsonTemplateSummaryV1 }) {
  const Icon = template.category === "weather" ? CloudSun : CurrencyEth;
  return (
    <section className="template-card" aria-label={template.title}>
      <div className="template-card-heading">
        <span className="template-card-icon" aria-hidden="true"><Icon size={24} /></span>
        {template.featured ? <span className="template-featured">Featured</span> : null}
      </div>
      <div>
        <span className="section-label">{template.provider}</span>
        <h2>{template.title}</h2>
        <p>{template.summary}</p>
      </div>
      <div className="template-card-actions">
        <a className="entry-secondary" href={`/templates/${template.id}`}>View details</a>
        <a
          className="entry-primary"
          href={`/runs/new?template=${template.id}&revision=${template.revision}&step=source`}
        >
          Use template <ArrowRight size={17} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}

function TemplateUnavailable() {
  return (
    <section className="entry-state is-error">
      <h1>Template unavailable</h1>
      <p>The requested built-in template could not be verified.</p>
      <a className="entry-secondary" href="/templates">Browse templates</a>
    </section>
  );
}

export function TemplateGallery() {
  const client = useTemplateClient();
  const [catalog, setCatalog] = useState<TemplateState<Web2JsonTemplateCatalogV1>>({
    state: "loading",
  });

  useEffect(() => {
    let active = true;
    void client.listTemplates().then(
      (value) => { if (active) setCatalog({ state: "ready", value }); },
      () => { if (active) setCatalog({ state: "unavailable" }); },
    );
    return () => { active = false; };
  }, [client]);

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="shell-main entry-shell-main">
        <Topbar title="Templates" attestationType="Web2Json" mode="index" />
        <main className="entry-layout template-gallery-page">
          {catalog.state === "loading" ? (
            <section className="entry-state" aria-live="polite">
              <span className="entry-state-spinner" aria-hidden="true" />
              <h1>Loading templates…</h1>
            </section>
          ) : catalog.state === "unavailable" ? (
            <TemplateUnavailable />
          ) : (
            <>
              <header className="entry-heading template-gallery-heading">
                <div>
                  <span className="section-label">Built-in Web2Json manifests</span>
                  <h1>Start from a template</h1>
                  <p>Choose a verified static starting point, then review every field in Composer.</p>
                </div>
                <a className="entry-secondary" href="/runs/new?step=source">Start blank</a>
              </header>
              <section className="template-gallery" aria-label="Web2Json templates">
                {catalog.value.templates.map((template) => (
                  <TemplateCard template={template} key={template.id} />
                ))}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export function TemplateDetail({ id }: { id: string }) {
  const client = useTemplateClient();
  const [detail, setDetail] = useState<TemplateState<Web2JsonTemplateDetailV1>>({
    state: "loading",
  });

  useEffect(() => {
    let active = true;
    void client.getTemplate({ id, revision: 1 }).then(
      (value) => { if (active) setDetail({ state: "ready", value }); },
      () => { if (active) setDetail({ state: "unavailable" }); },
    );
    return () => { active = false; };
  }, [client, id]);

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="shell-main entry-shell-main">
        <Topbar title="Template detail" attestationType="Web2Json" mode="new" />
        <main className="entry-layout template-detail-page">
          {detail.state === "loading" ? (
            <section className="entry-state" aria-live="polite">
              <span className="entry-state-spinner" aria-hidden="true" />
              <h1>Loading template…</h1>
            </section>
          ) : detail.state === "unavailable" ? (
            <TemplateUnavailable />
          ) : (
            <>
              <a className="composer-back" href="/templates">
                <ArrowLeft size={17} aria-hidden="true" />Back to templates
              </a>
              <header className="template-detail-heading">
                <span className="section-label">{detail.value.template.category} template</span>
                <h1>{detail.value.template.title}</h1>
                <p>{detail.value.template.summary}</p>
                <a
                  className="entry-primary"
                  href={`/runs/new?template=${detail.value.template.id}&revision=${detail.value.template.revision}&step=source`}
                >
                  Use template <ArrowRight size={17} aria-hidden="true" />
                </a>
              </header>
              <section className="template-provenance" aria-label="Template provenance">
                <span className="section-label">Template provenance</span>
                <dl>
                  <div><dt>Provider</dt><dd>{detail.value.template.provider}</dd></div>
                  <div><dt>Revision</dt><dd>Revision {detail.value.template.revision}</dd></div>
                  <div><dt>Manifest digest</dt><dd><code>{detail.value.template.manifestSha256}</code></dd></div>
                </dl>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
