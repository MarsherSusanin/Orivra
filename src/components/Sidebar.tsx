import { ChartBar, Code, FileText, Gear, UsersThree } from "@phosphor-icons/react";
import prooflineMark from "../assets/proofline-mark.png";

const items = [
  { label: "Runs", icon: ChartBar, active: true },
  { label: "Requests", icon: FileText },
  { label: "Consumers", icon: UsersThree },
  { label: "CI", icon: Code },
  { label: "Settings", icon: Gear },
];

export function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <a className="brand-mark" href="#run" aria-label="Proofline home">
        <img src={prooflineMark} width="48" height="48" alt="" />
      </a>
      <nav className="nav-list">
        {items.map(({ label, icon: Icon, active }) => (
          <a
            className={`nav-item${active ? " is-active" : ""}`}
            href={active ? "#run" : `#${label.toLowerCase()}`}
            aria-current={active ? "page" : undefined}
            key={label}
          >
            <Icon size={27} weight={active ? "fill" : "regular"} aria-hidden="true" />
            <span>{label}</span>
          </a>
        ))}
      </nav>
    </aside>
  );
}
