import {
  CheckCircle,
  ClipboardText,
  LinkSimple,
  SpinnerGap,
  X,
} from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  canonicalSerializeEvidenceReceipt,
  createEvidenceReceipt,
  replayProofBundle,
} from "../../packages/domain/src";
import type {
  EvidenceReceiptV1,
  ShareLinkV1,
} from "../../packages/contracts/src";
import type {
  RunServiceContext,
  RunSurfaceServices,
} from "../services/run-surface";

type PackageEvidence = {
  receipt: EvidenceReceiptV1;
  receiptBytes: string;
  bundle: string;
  manifest: string;
  solidity: string;
  contractName: string;
};

function safeError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "Integration package is unavailable";
  return message
    .replace(/(?:project|share)_[a-f0-9]{64}/gi, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}

function dataHref(mediaType: string, bytes: string): string {
  return `data:${mediaType};charset=utf-8,${encodeURIComponent(bytes)}`;
}

function workflowYaml(runId: string): string {
  return [
    "name: Proofline replay",
    "on: [pull_request]",
    "jobs:",
    "  proofline:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: ./packages/action",
    "        with:",
    "          mode: replay",
    `          manifest: ${runId}.manifest.json`,
    `          bundle: ${runId}.proofline.json`,
    "",
  ].join("\n");
}

export function IntegrationPackageDialog({
  context,
  services,
  onClose,
}: {
  context: RunServiceContext;
  services: RunSurfaceServices;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const shareFlight = useRef<Promise<ShareLinkV1> | null>(null);
  const [evidence, setEvidence] = useState<PackageEvidence | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [shareLink, setShareLink] = useState<ShareLinkV1 | null>(null);
  const [sharing, setSharing] = useState(false);
  const projectAccess = context.projectToken.startsWith("project_");

  useLayoutEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!services.getEvidenceReceipt || !services.getConsumerLabReport) {
        setError("Persisted handoff evidence is unavailable");
        return;
      }
      try {
        const [receipt, report, bundle] = await Promise.all([
          services.getEvidenceReceipt(context),
          services.getConsumerLabReport(context),
          services.exportBundle(context),
        ]);
        const localReceipt = createEvidenceReceipt(bundle);
        const receiptBytes = canonicalSerializeEvidenceReceipt(receipt);
        if (
          canonicalSerializeEvidenceReceipt(localReceipt) !== receiptBytes ||
          report.runId !== context.runId ||
          report.safeConsumer.sha256 !== receipt.safeConsumerChecksum ||
          report.safeConsumer.compileStatus !== "passed"
        ) {
          throw new Error("Persisted handoff evidence does not agree byte-for-byte");
        }
        const decoded = replayProofBundle(bundle);
        if (cancelled) return;
        setEvidence({
          receipt,
          receiptBytes,
          bundle,
          manifest: JSON.stringify(decoded.manifest),
          solidity: report.safeConsumer.source,
          contractName: report.safeConsumer.contractName,
        });
      } catch (cause) {
        if (!cancelled) setError(safeError(cause));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [context, services]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);

  const trapFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      ) ?? [],
    );
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

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(`${label} copied`);
    } catch {
      setCopied(`${label} could not be copied`);
    }
  };

  const createShare = async () => {
    if (!projectAccess || !services.createShare || shareFlight.current) return;
    setSharing(true);
    setError("");
    const flight = services.createShare({
      ...context,
      idempotencyKey: `share-${context.runId}`,
    });
    shareFlight.current = flight;
    try {
      setShareLink(await flight);
    } catch (cause) {
      setError(safeError(cause));
    } finally {
      shareFlight.current = null;
      setSharing(false);
    }
  };

  const cli = `node packages/cli/dist/index.js replay ${context.runId}.proofline.json`;
  const yaml = workflowYaml(context.runId);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="verification-dialog integration-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="integration-title"
        onKeyDown={trapFocus}
      >
        <header className="dialog-header">
          <div><span className="dialog-kicker">Evidence handoff</span><h2 id="integration-title">Integration package</h2></div>
          <button ref={closeRef} className="close-button" type="button" onClick={onClose} aria-label="Close integration package"><X size={22} aria-hidden="true" /></button>
        </header>
        <div className="dialog-body integration-body">
          {!projectAccess ? <p className="shared-readonly"><LinkSimple size={17} aria-hidden="true" />Read-only shared run</p> : null}
          {!evidence && !error ? (
            <div className="verification-running" role="status"><SpinnerGap className="spinner" size={30} aria-hidden="true" /><div><strong>Preparing persisted evidence</strong><span>Verifying receipt and artifact bytes locally…</span></div></div>
          ) : null}
          {error ? <div className="verification-error" role="alert"><strong>Integration package unavailable</strong><p>{error}</p></div> : null}
          {evidence ? (
            <>
              <section className="integration-verdict" aria-label="Integration verdict">
                <CheckCircle size={26} weight="fill" aria-hidden="true" />
                <div><strong>Ready for repository integration</strong><span>The receipt, proof bundle and generated consumer match persisted evidence.</span></div>
              </section>
              <dl className="receipt-facts" aria-label="Evidence receipt">
                <div><dt>Run</dt><dd>{evidence.receipt.runId}</dd></div>
                <div><dt>Transaction</dt><dd>{evidence.receipt.transactionHash ?? "Replay · no broadcast"}</dd></div>
                <div><dt>Voting round</dt><dd>{evidence.receipt.votingRound}</dd></div>
                <div><dt>Proof checksum</dt><dd>{evidence.receipt.proofChecksum}</dd></div>
                <div><dt>Bundle checksum</dt><dd>{evidence.receipt.bundleChecksum}</dd></div>
                <div><dt>Consumer result</dt><dd>{evidence.receipt.consumerResult.passed ? "Passed" : "Invariant evidence recorded"}</dd></div>
                <div><dt>Safe consumer</dt><dd>{evidence.receipt.safeConsumerChecksum}</dd></div>
                <div><dt>Replay</dt><dd>Byte-identical</dd></div>
              </dl>
              <div className="integration-artifacts" aria-label="Integration artifacts">
                <div><strong>Evidence receipt</strong><button type="button" onClick={() => void copy("Receipt", evidence.receiptBytes)}>Copy receipt</button><a download={`${context.runId}.receipt.json`} href={dataHref("application/json", evidence.receiptBytes)}>Download receipt</a></div>
                <div><strong>Proof bundle</strong><a download={`${context.runId}.proofline.json`} href={dataHref("application/json", evidence.bundle)}>Download bundle</a></div>
                <div><strong>Manifest</strong><a download={`${context.runId}.manifest.json`} href={dataHref("application/json", evidence.manifest)}>Download manifest</a></div>
                <div><strong>Generated consumer</strong><a download={`${evidence.contractName}.sol`} href={dataHref("text/plain", evidence.solidity)}>Download Solidity</a></div>
                <div><strong>GitHub Action</strong><button type="button" onClick={() => void copy("Workflow", yaml)}>Copy workflow YAML</button></div>
              </div>
              <div className="integration-code" aria-label="CLI replay command"><span>Repository-local CLI</span><pre><code>{cli}</code></pre></div>
              <div className="integration-code" aria-label="GitHub Action workflow"><span>Repository-local GitHub Action</span><pre><code>{yaml}</code></pre></div>
              <button className="dialog-primary" type="button" onClick={() => void copy("CLI command", cli)}><ClipboardText size={20} aria-hidden="true" />Copy CLI replay command</button>
              {projectAccess && services.createShare ? (
                <div className="share-handoff">
                  {shareLink ? <a href={shareLink.url}>Open read-only share</a> : <button type="button" disabled={sharing} onClick={() => void createShare()}>{sharing ? "Creating share link…" : "Create read-only share link"}</button>}
                </div>
              ) : null}
              <p className="integration-next"><strong>Next integration step</strong><span>Commit the bundle and generated consumer, then add the generated workflow to your repository.</span></p>
              <span className="copy-status" aria-live="polite">{copied}</span>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
