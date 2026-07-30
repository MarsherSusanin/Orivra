import { ArrowSquareOut, Check, Copy } from "@phosphor-icons/react";
import { useState } from "react";
import { evidenceItems } from "../data/run";

export function EvidenceStrip() {
  const [copied, setCopied] = useState(false);
  const copyHash = async () => {
    await navigator.clipboard?.writeText("0x9f3e0000000000000000000000007ab2c1d4");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <section className="evidence-strip" aria-label="Run evidence">
      {evidenceItems.map((item) => (
        <div className="evidence-item" key={item.label}>
          <span className="evidence-label">{item.label}</span>
          <span className="evidence-value">
            {item.value}
            {item.kind === "copy" ? (
              <button className="icon-button" type="button" onClick={copyHash} aria-label="Copy transaction hash">
                {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
              </button>
            ) : null}
            {item.kind === "external" ? <ArrowSquareOut size={18} aria-hidden="true" /> : null}
          </span>
        </div>
      ))}
    </section>
  );
}
