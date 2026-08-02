import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  ShieldCheck,
  Warning,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";
import type { PreflightReportV1 } from "../../packages/contracts/src";
import type { SubmissionModeView } from "../services/run-surface";

type SubmissionState = "idle" | "submitting" | "accepted" | "error";

const modeEvidence = {
  wallet: {
    title: "Wallet submission",
    signer: "Connected wallet",
    payer: "Wallet pays the quoted fee",
    effect: "Broadcasts one transaction to Coston2",
    trust: "Proofline never receives your private key",
    action: "Confirm wallet submission",
  },
  relayer: {
    title: "Relayer submission",
    signer: "Proofline relayer",
    payer: "Relayer pays the quoted fee",
    effect: "Worker broadcasts one policy-limited transaction to Coston2",
    trust: "Project authorization is enforced by relayer policy",
    action: "Confirm relayer submission",
  },
  replay: {
    title: "Replay submission",
    signer: "No signer",
    payer: "No payer",
    effect: "No network effect",
    trust: "Uses only persisted recorded evidence",
    action: "Confirm replay",
  },
} as const;

function safeSubmissionError(cause: unknown): string {
  const code = cause && typeof cause === "object" && "code" in cause
    ? (cause as { code?: unknown }).code
    : undefined;
  if (code === "RELAYER_QUOTA_EXHAUSTED") {
    return "The relayer quota is exhausted. Create a replay run or try again after the quota resets.";
  }
  if (code === "GLOBAL_FEE_CAP_EXCEEDED") {
    return "The quoted fee exceeds the relayer policy cap. Create a new run with a suitable fee cap.";
  }
  if (code === "BALANCE_FLOOR_VIOLATION") {
    return "The relayer cannot safely fund this request. Try again after its balance is restored.";
  }
  if (code === "WALLET_PROVIDER_UNAVAILABLE") {
    return "No EIP-1193 wallet is available in this browser. Connect a wallet and try again.";
  }
  if (code === "SUBMISSION_NOT_READY" || code === "PREFLIGHT_NOT_READY") {
    return "Preflight evidence is not ready for submission yet.";
  }
  return "Submission is temporarily unavailable. Your run is unchanged; try again safely.";
}

export function SubmissionDecision({
  mode,
  report,
  canConfirm,
  idempotencyKey,
  onConfirm,
  onRequested,
  onBack,
}: {
  mode: SubmissionModeView;
  report: PreflightReportV1;
  canConfirm: boolean;
  idempotencyKey: string;
  onConfirm(context: {
    mode: SubmissionModeView;
    idempotencyKey: string;
  }): Promise<unknown>;
  onRequested(mode: SubmissionModeView): void;
  onBack(): void;
}) {
  const [state, setState] = useState<SubmissionState>("idle");
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const evidence = modeEvidence[mode];

  const confirm = async () => {
    if (!canConfirm || inFlight.current || state === "accepted") return;
    inFlight.current = true;
    setState("submitting");
    setError("");
    onRequested(mode);
    try {
      await onConfirm({ mode, idempotencyKey });
      setState("accepted");
    } catch (cause) {
      setError(safeSubmissionError(cause));
      setState("error");
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <section
      className={`next-action submission-decision is-${mode}`}
      aria-label="Submission decision"
    >
      <header className="submission-decision-heading">
        <span className="submission-decision-icon" aria-hidden="true">
          {state === "accepted"
            ? <CheckCircle size={38} weight="duotone" />
            : <ShieldCheck size={38} weight="duotone" />}
        </span>
        <div>
          <span className="section-label">Immutable submission mode</span>
          <h2>{evidence.title}</h2>
          <p>
            Review who signs, who pays, and what external effect this persisted
            run is authorized to create.
          </p>
        </div>
        <span className="submission-mode-badge">{mode}</span>
      </header>

      <dl className="submission-trust-grid" aria-label={`${mode} trust model`}>
        <div><dt>Signer</dt><dd>{evidence.signer}</dd></div>
        <div><dt>Payer</dt><dd>{evidence.payer}</dd></div>
        <div><dt>Network effect</dt><dd>{evidence.effect}</dd></div>
        <div><dt>Trust model</dt><dd>{evidence.trust}</dd></div>
      </dl>

      <section className="submission-request-evidence" aria-labelledby="submission-request-title">
        <div className="submission-section-heading">
          <div>
            <span className="section-label">Exact request</span>
            <h3 id="submission-request-title">Coston2 authorization boundary</h3>
          </div>
          <span className="submission-chain">Chain 114</span>
        </div>
        <dl className="submission-evidence-grid">
          <div>
            <dt>Network</dt>
            <dd>Coston2</dd>
          </div>
          <div>
            <dt>Quoted fee</dt>
            <dd><code>{report.fee.quotedWei}</code> wei</dd>
          </div>
          <div>
            <dt>Fee cap</dt>
            <dd><code>{report.fee.capWei}</code> wei</dd>
          </div>
          <div className="is-wide">
            <dt>Registry-resolved FdcHub</dt>
            <dd><code>{report.registrySnapshot.resolvedContracts.FdcHub}</code></dd>
          </div>
          <div className="is-wide">
            <dt>Request SHA-256</dt>
            <dd><code>{report.requestIdentitySha256}</code></dd>
          </div>
        </dl>
      </section>

      {error ? (
        <div className="submission-error" role="alert">
          <Warning size={20} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <footer className="submission-actions">
        <button className="submission-back" type="button" onClick={onBack}>
          <ArrowLeft size={17} aria-hidden="true" />
          Review preflight evidence
        </button>
        <a className="submission-change-mode" href="/runs/new?step=submit">
          Change mode in a new run
        </a>
        {canConfirm ? (
          <button
            className="verify-button submission-confirm"
            type="button"
            disabled={state === "submitting" || state === "accepted"}
            onClick={() => void confirm()}
          >
            {state === "submitting"
              ? "Confirming…"
              : state === "accepted"
                ? "Submission accepted"
                : state === "error"
                  ? `Try again · ${evidence.action}`
                  : evidence.action}
            <ArrowRight size={24} weight="bold" aria-hidden="true" />
          </button>
        ) : (
          <p className="submission-read-only">
            Submission is unavailable for read-only, blocked, or terminal runs.
          </p>
        )}
      </footer>
    </section>
  );
}
