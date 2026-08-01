import { ChartBar, Code, FileText, Gear, UsersThree } from "@phosphor-icons/react";
import prooflineMark from "../assets/proofline-mark.png";

const items = [
  { label: "Runs", icon: ChartBar, href: "/runs" },
  { label: "Requests", icon: FileText },
  { label: "Consumers", icon: UsersThree },
  { label: "CI", icon: Code },
  { label: "Settings", icon: Gear },
];

export function Sidebar({ active = "Runs" }: { active?: string }) {
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <a className="brand-mark" href="/runs" aria-label="Proofline home">
        <img src={prooflineMark} width="48" height="48" alt="" />
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
              className="nav-item is-disabled"
              type="button"
              disabled
              title={`${label} is not available in this build`}
              key={label}
            >
              <Icon size={27} aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
