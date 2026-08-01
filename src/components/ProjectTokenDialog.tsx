import { Key, LockKey, X } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState } from "react";

const PROJECT_TOKEN = /^project_[a-f0-9]{64}$/i;

export function ProjectTokenDialog({
  onConnect,
  onClose,
  backHref,
}: {
  onConnect: (projectToken: string) => void;
  onClose?: () => void;
  backHref?: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    inputRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = value.trim();
    if (!PROJECT_TOKEN.test(token)) {
      setError("Enter a valid Proofline project token.");
      inputRef.current?.focus();
      return;
    }
    setError("");
    onConnect(token);
  };

  const trapFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && onClose) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "input:not([disabled]), button:not([disabled]), a[href]",
      ) ?? [],
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="verification-dialog project-token-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-token-title"
        aria-describedby="project-token-description"
        onKeyDown={trapFocus}
      >
        <header className="dialog-header">
          <div>
            <span className="dialog-kicker">Production run</span>
            <h2 id="project-token-title">Connect project</h2>
          </div>
          {onClose ? (
            <button
              className="close-button"
              type="button"
              onClick={onClose}
              aria-label="Close project connection"
            >
              <X size={22} aria-hidden="true" />
            </button>
          ) : (
            <span className="project-lock" aria-hidden="true"><LockKey size={22} /></span>
          )}
        </header>
        <form className="dialog-body project-token-form" onSubmit={submit}>
          <p id="project-token-description">
            Enter a project token to open this persisted run. It stays in this browser session only.
          </p>
          <label className="field-label" htmlFor="project-token">Project token</label>
          <div className="address-field project-token-field">
            <Key size={20} aria-hidden="true" />
            <input
              ref={inputRef}
              id="project-token"
              name="project-token"
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={error ? "true" : undefined}
              aria-describedby={error ? "project-token-error" : undefined}
            />
          </div>
          {error ? <p className="project-token-error" id="project-token-error" role="alert">{error}</p> : null}
          <button className="dialog-primary" type="submit">Open run<LockKey size={20} weight="bold" aria-hidden="true" /></button>
          {backHref ? <a className="project-token-back" href={backHref}>Back to runs</a> : null}
        </form>
      </section>
    </div>
  );
}
