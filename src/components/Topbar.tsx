import { CaretDown, CaretRight, FileCode, GlobeHemisphereWest } from "@phosphor-icons/react";

export function Topbar({
  title = "ETH/USD snapshot",
  network = "Coston2",
  attestationType = "Web2Json",
}: {
  title?: string;
  network?: string;
  attestationType?: string;
}) {
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
          <a href="#runs">Runs</a>
          <CaretRight size={15} aria-hidden="true" />
          <span>{title}</span>
        </div>
      </div>
      <div className="topbar-right">
        <span className="proof-status"><span className="status-dot" aria-hidden="true" />Proof available</span>
        <span className="attestation-type"><FileCode size={24} aria-hidden="true" />{attestationType}</span>
      </div>
    </header>
  );
}
