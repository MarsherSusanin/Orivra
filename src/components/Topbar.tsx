import { CaretDown, CaretRight, FileCode, GlobeHemisphereWest } from "@phosphor-icons/react";

export function Topbar({
  title,
  network = "Coston2",
  attestationType = "Web2Json",
  mode = "detail",
  proofAvailable = false,
  statusLabel,
}: {
  title: string | undefined;
  network?: string;
  attestationType?: string;
  mode?: "detail" | "index" | "new" | "overview";
  proofAvailable?: boolean;
  statusLabel?: string;
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
          {mode === "overview" ? <span>Overview</span> : null}
          {mode === "index" ? <span>Runs</span> : null}
          {mode !== "index" && mode !== "overview" ? <a href="/runs">Runs</a> : null}
          {mode !== "index" && mode !== "overview" ? <CaretRight size={15} aria-hidden="true" /> : null}
          {mode !== "index" && mode !== "overview" ? <span>{breadcrumbTitle}</span> : null}
        </div>
      </div>
      <div className="topbar-right">
        {mode === "detail" ? (
          <span className={`proof-status${proofAvailable ? "" : " is-progress"}`}>
            <span className="status-dot" aria-hidden="true" />
            {proofAvailable ? "Proof available" : (statusLabel ?? "Run status unavailable")}
          </span>
        ) : null}
        <span className="attestation-type"><FileCode size={24} aria-hidden="true" />{attestationType}</span>
      </div>
    </header>
  );
}
