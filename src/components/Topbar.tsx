import { CaretDown, CaretRight, FileCode, GlobeHemisphereWest } from "@phosphor-icons/react";

export function Topbar({
  title,
  network = "Coston2",
  attestationType = "Web2Json",
  mode = "detail",
}: {
  title: string | undefined;
  network?: string;
  attestationType?: string;
  mode?: "detail" | "index" | "new";
}) {
  const breadcrumbTitle = title?.trim() || "Run unavailable";
  return (
    <header className="topbar">
      <div className="topbar-left">
        <strong className="wordmark">Proofline</strong>
        <span className="topbar-divider" aria-hidden="true" />
        <button className="network-switcher" type="button" aria-label={`Network: ${network}`}>
          <GlobeHemisphereWest size={24} aria-hidden="true" />
          <span>{network}</span>
          <CaretDown size={15} weight="bold" aria-hidden="true" />
        </button>
        <span className="topbar-divider" aria-hidden="true" />
        <div className="breadcrumbs" aria-label="Breadcrumb">
          {mode === "index" ? <span>Runs</span> : <a href="/runs">Runs</a>}
          {mode !== "index" ? <CaretRight size={15} aria-hidden="true" /> : null}
          {mode !== "index" ? <span>{breadcrumbTitle}</span> : null}
        </div>
      </div>
      <div className="topbar-right">
        {mode === "detail" ? <span className="proof-status"><span className="status-dot" aria-hidden="true" />Proof available</span> : null}
        <span className="attestation-type"><FileCode size={24} aria-hidden="true" />{attestationType}</span>
      </div>
    </header>
  );
}
