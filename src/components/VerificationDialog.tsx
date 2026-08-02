import { Check, Code, ShieldCheck, SpinnerGap, Warning, X } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ConsumerLabReportV1 } from "../../packages/contracts/src";
import type {
  ConsumerVerificationResult,
  GeneratedConsumer,
  RunServiceContext,
  RunSurfaceServices,
} from "../services/run-surface";
import type { ProductEventInputV1 } from "../services/product-analytics";

type VerificationStatus = "idle" | "running" | "complete" | "error";

function safeError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "Consumer verification failed";
  return message
    .replace(/(?:project|share)_[a-f0-9]{64}/gi, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}

export function VerificationDialog({
  context,
  services,
  onClose,
  onVerified,
  onProductEvent,
}: {
  context: RunServiceContext;
  services: RunSurfaceServices;
  onClose: () => void;
  onVerified?: () => void;
  onProductEvent?: (event: ProductEventInputV1) => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const resultActionRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<VerificationStatus>("idle");
  const [result, setResult] = useState<ConsumerVerificationResult | null>(null);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedConsumer | null>(null);
  const [report, setReport] = useState<ConsumerLabReportV1 | null>(null);
  const [artifactVerified, setArtifactVerified] = useState(false);

  useLayoutEffect(() => {
    closeRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (status === "complete" && result) {
      resultActionRef.current?.focus();
    }
  }, [result, status]);

  useLayoutEffect(() => {
    if (generated) {
      closeRef.current?.focus();
    }
  }, [generated]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      ) ?? [],
    ).filter((element) => !element.hasAttribute("aria-hidden"));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const runVerification = async () => {
    setStatus("running");
    setError("");
    setResult(null);
    setGenerated(null);
    try {
      const nextResult = await services.verifyConsumer(context);
      setResult(nextResult);
      setStatus("complete");
      if (nextResult.checks.some((check) => check.status === "failed")) {
        onProductEvent?.({
          name: "CONSUMER_VERIFICATION_FAILED",
          metadata: { category: "consumer-invariant" },
        });
      }
      onVerified?.();
    } catch (cause) {
      setError(safeError(cause));
      setStatus("error");
    }
  };

  const generateConsumer = async () => {
    setGenerating(true);
    setError("");
    try {
      const consumer = await services.generateConsumer(context);
      setGenerated(consumer);
      if (services.getConsumerLabReport) {
        setReport(await services.getConsumerLabReport(context));
      }
      onProductEvent?.({
        name: "SAFE_CODEGEN_GENERATED",
        metadata: { target: "solidity" },
      });
    } catch (cause) {
      setError(safeError(cause));
    } finally {
      setGenerating(false);
    }
  };

  const verifyGeneratedConsumer = async () => {
    if (!report) return;
    setError("");
    try {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(report.safeConsumer.source),
      );
      const actual = [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      if (`sha256:${actual}` !== report.safeConsumer.sha256 || report.safeConsumer.compileStatus !== "passed") {
        throw new Error("Generated consumer integrity or compile evidence is invalid");
      }
      setArtifactVerified(true);
    } catch (cause) {
      setError(safeError(cause));
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="verification-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="verification-title"
        onKeyDown={handleKeyDown}
      >
        <header className="dialog-header">
          <div><span className="dialog-kicker">Consumer lab</span><h2 id="verification-title">Consumer verification</h2></div>
          <button ref={closeRef} className="close-button" type="button" onClick={onClose} aria-label="Close consumer verification"><X size={22} aria-hidden="true" /></button>
        </header>
        <div className="dialog-body">
          <div className="address-field" aria-label="Consumer identity">
            <ShieldCheck size={20} aria-hidden="true" />
            <strong>Canonical vulnerable consumer</strong>
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
              <div><strong>Verifying consumer call</strong><span>Checking proof and application invariants…</span></div>
            </div>
          ) : null}
          {status === "error" ? (
            <div className="verification-error" role="alert">
              <div><Warning size={22} aria-hidden="true" /><strong>Verification could not complete</strong></div>
              <code>VERIFICATION_TRANSPORT_FAILED</code>
              <p>{error}</p>
              <span>Run state is preserved. Retry continues with the same evidence.</span>
              <button className="dialog-primary" type="button" onClick={runVerification}>Retry verification<ShieldCheck size={20} weight="bold" aria-hidden="true" /></button>
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
              {error ? <p className="generation-error" role="alert">{error}</p> : null}
              {!generated ? (
                <button ref={resultActionRef} className="dialog-primary" type="button" disabled={generating} onClick={generateConsumer}>
                  {generating ? "Generating safe consumer…" : "Generate safe consumer"}<Code size={21} weight="bold" aria-hidden="true" />
                </button>
              ) : report ? (
                <div className="consumer-lab-report">
                  <div className="consumer-lab-statement">
                    <strong>{report.statement}</strong>
                    <span>{report.verdict.state === "safe-to-integrate" ? "Safe to integrate" : `Still missing ${report.verdict.missingChecks} checks`}</span>
                  </div>
                  <ul className="consumer-matrix" aria-label="Consumer URL invariant comparison">
                    {report.checks.map((check) => (
                      <li key={check.invariant}>
                        <strong>{check.invariant}</strong>
                        <span>Expected <code>{check.expected || "—"}</code></span>
                        <span>Observed <code>{check.observed || "—"}</code></span>
                        <span>{check.enforced ? "Enforced" : "Not enforced"}</span>
                        <span>{check.passed ? "Passed" : "Missing"}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="generated-code">
                    <span><Check size={17} weight="bold" aria-hidden="true" />{report.safeConsumer.contractName} · {report.safeConsumer.compileStatus} · {report.safeConsumer.sha256}</span>
                    <pre><code>{report.safeConsumer.diff}</code></pre>
                    <div className="consumer-artifact-actions">
                      <button type="button" onClick={() => void navigator.clipboard?.writeText(report.safeConsumer.source)}>Copy Solidity</button>
                      <a download={`${report.safeConsumer.contractName}.sol`} href={`data:text/plain;charset=utf-8,${encodeURIComponent(report.safeConsumer.source)}`}>Download .sol</a>
                      <button type="button" onClick={() => void verifyGeneratedConsumer()}>{artifactVerified ? "Generated consumer verified" : "Verify generated consumer"}</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="generated-code"><span><Check size={17} weight="bold" aria-hidden="true" />Safe consumer generated</span><code>{generated.source}</code></div>
              )}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
