import { Check, FileText, Hourglass, UserCircle, Warning } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import type { RunStage } from "../data/run";

const stageIcons = { complete: Check, active: FileText, pending: Hourglass, failed: Warning };

export function RunTimeline({ stages }: { stages: RunStage[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.innerWidth <= 640) {
      const scroller = scrollerRef.current;
      window.requestAnimationFrame(() => scroller?.scrollTo({ left: 220, behavior: "auto" }));
    }
  }, []);

  return (
    <div
      className="timeline-scroller"
      ref={scrollerRef}
      tabIndex={0}
      aria-label="Attestation lifecycle timeline"
    >
      <ol className="timeline" aria-label="Attestation lifecycle">
        {stages.map((stage, index) => {
          const Icon = stage.key === "consumer" && stage.state === "pending" ? UserCircle : stageIcons[stage.state];
          return (
            <li className={`timeline-stage is-${stage.state}`} key={stage.key}>
              <span className="stage-label">{stage.label}</span>
              <span className="stage-axis">
                {index > 0 ? <span className="axis-line axis-before" aria-hidden="true" /> : null}
                <span className="stage-node" role="img" aria-label={`${stage.label}: ${stage.status}`}>
                  <Icon size={28} weight={stage.state === "complete" ? "bold" : "regular"} aria-hidden="true" />
                </span>
                {index < stages.length - 1 ? <span className="axis-line axis-after" aria-hidden="true" /> : null}
              </span>
              <span className="stage-status">{stage.status}</span>
              <span className="stage-meta">{stage.time}</span>
              <span className="stage-meta">{stage.duration}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
