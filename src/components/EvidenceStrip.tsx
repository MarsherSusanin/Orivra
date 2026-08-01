import { ArrowSquareOut, Check, Copy } from "@phosphor-icons/react";
import { useState } from "react";
import type { EvidenceItem } from "../data/run";

export function EvidenceStrip({ items }: { items: readonly EvidenceItem[] | undefined }) {
  const [copied, setCopied] = useState(false);
  const copyHash = async (value: string) => {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <section className="evidence-strip" aria-label="Run evidence">
      {items === undefined ? (
        <div className="evidence-unavailable" role="status">Run evidence is unavailable.</div>
      ) : items.length === 0 ? (
        <div className="evidence-unavailable" role="status">No run evidence has been recorded.</div>
      ) : items.map((item) => (
        <div className="evidence-item" key={item.label}>
          <span className="evidence-label">{item.label}</span>
          <span className="evidence-value">
            {item.value}
            {item.kind === "copy" ? (
              <button className="icon-button" type="button" onClick={() => copyHash(item.rawValue ?? item.value)} aria-label="Copy transaction hash">
                {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
              </button>
            ) : null}
            {item.kind === "external" && item.href ? (
              <a className="evidence-link" href={item.href} target="_blank" rel="noreferrer" aria-label="View transaction on Blockscout">
                <ArrowSquareOut size={18} aria-hidden="true" />
              </a>
            ) : item.kind === "external" ? <ArrowSquareOut size={18} aria-hidden="true" /> : null}
          </span>
        </div>
      ))}
    </section>
  );
}
