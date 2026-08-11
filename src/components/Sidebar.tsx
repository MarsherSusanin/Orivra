import { ChartBar, Code, FileText, Gear, UsersThree } from "@phosphor-icons/react";
import { useState } from "react";
import orivraMark from "../assets/orivra-mark.svg";

const items = [
  { label: "Runs", icon: ChartBar, href: "/runs" },
  { label: "Requests", icon: FileText },
  { label: "Consumers", icon: UsersThree },
  { label: "CI", icon: Code },
  { label: "Settings", icon: Gear, href: "/settings" },
];

export function Sidebar({ active = "Runs" }: { active?: string }) {
  const [explainedItem, setExplainedItem] = useState<string>();

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <a className="brand-mark" href="/" aria-label="Orivra home">
        <img src={orivraMark} width="48" height="48" alt="" />
      </a>
      <nav className="nav-list">
        {items.map(({ label, icon: Icon, href }) => {
          const isActive = label === active;
          return href ? (
            <a
              className={`nav-item${isActive ? " is-active" : ""}`}
              href={href}
              aria-current={isActive ? "page" : undefined}
              key={label}
            >
              <Icon size={27} weight={isActive ? "fill" : "regular"} aria-hidden="true" />
              <span>{label}</span>
            </a>
          ) : (
            <button
              className={`nav-item is-disabled${explainedItem === label ? " is-explaining" : ""}`}
              type="button"
              aria-label={label}
              aria-disabled="true"
              aria-describedby={`nav-${label.toLowerCase()}-unavailable`}
              onClick={() => setExplainedItem(label)}
              title={`${label} is not available in this build`}
              key={label}
            >
              <Icon size={27} aria-hidden="true" />
              <span>{label}</span>
              <span
                className="nav-unavailable-note"
                id={`nav-${label.toLowerCase()}-unavailable`}
              >
                {label} is not available in this build
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
