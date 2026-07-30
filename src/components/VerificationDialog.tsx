import { Check, Code, ShieldCheck, SpinnerGap, Warning, X } from "@phosphor-icons/react";
import { useState } from "react";
import { simulateConsumerVerification } from "../data/run";

type VerificationResult = Awaited<ReturnType<typeof simulateConsumerVerification>>;

export function VerificationDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<"idle" | "running" | "complete">("idle");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [generated, setGenerated] = useState(false);

  const runVerification = async () => {
    setStatus("running");
    const nextResult = await simulateConsumerVerification();
    setResult(nextResult);
    setStatus("complete");
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="verification-dialog" role="dialog" aria-modal="true" aria-labelledby="verification-title">
        <header className="dialog-header">
          <div><span className="dialog-kicker">Consumer lab</span><h2 id="verification-title">Consumer verification</h2></div>
          <button className="close-button" type="button" onClick={onClose} aria-label="Close consumer verification"><X size={22} aria-hidden="true" /></button>
        </header>
        <div className="dialog-body">
          <label className="field-label" htmlFor="consumer-address">Consumer contract</label>
          <div className="address-field">
            <ShieldCheck size={20} aria-hidden="true" />
            <input id="consumer-address" value="0x71C4...9A2E" readOnly />
            <span>Coston2</span>
          </div>
          {status === "idle" ? (
            <div className="dialog-intro">
              <p>Run the proof through the configured consumer before broadcasting a transaction.</p>
              <button className="dialog-primary" type="button" onClick={runVerification}>Run verification<ShieldCheck size={20} weight="bold" aria-hidden="true" /></button>
            </div>
          ) : null}
          {status === "running" ? (
            <div className="verification-running" aria-live="polite">
              <SpinnerGap className="spinner" size={30} aria-hidden="true" />
              <div><strong>Simulating consumer call</strong><span>Checking proof and application invariants…</span></div>
            </div>
          ) : null}
          {status === "complete" && result ? (
            <div className="verification-result" aria-live="polite">
              <div className="result-heading">
                <span className="result-icon"><Warning size={25} aria-hidden="true" /></span>
                <div><h3>{result.summary}</h3><code>{result.code}</code></div>
              </div>
              <ul className="check-list" aria-label="Verification checks">
                {result.checks.map((check) => (
                  <li className={`check-row is-${check.status}`} key={check.label}>
                    {check.status === "passed" ? <Check size={18} weight="bold" aria-hidden="true" /> : <Warning size={18} weight="bold" aria-hidden="true" />}
                    <span>{check.label}</span><strong>{check.status === "passed" ? "Passed" : "Missing"}</strong>
                  </li>
                ))}
              </ul>
              {!generated ? (
                <button className="dialog-primary" type="button" onClick={() => setGenerated(true)}>Generate safe consumer<Code size={21} weight="bold" aria-hidden="true" /></button>
              ) : (
                <div className="generated-code"><span><Check size={17} weight="bold" aria-hidden="true" />Safe consumer generated</span><code>requireHost(requestUrl, EXPECTED_HOST);</code></div>
              )}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
