"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { label: string; href?: string; match?: string[]; count?: number };

const OFF = "Outside this prototype";

function itemsFor(role: string, pending: number): { badge: string; items: Item[]; suffix: string } {
  if (role === "ACCOUNTS")
    return {
      badge: "ACCOUNTS",
      suffix: "SD Accounts",
      items: [
        { label: "Dashboard" }, { label: "Billing" }, { label: "Client ledger" },
        { label: "Lost & Damage", href: "/accounts", match: ["/accounts", "/cases"] },
        { label: "Reports" },
      ],
    };
  if (role === "MANAGEMENT")
    return {
      badge: "MANAGEMENT",
      suffix: "Management",
      items: [
        { label: "L&D Dashboard", href: "/management", match: ["/management", "/cases"] },
        { label: "Approvals & escalations", href: "/management/approvals", count: pending },
        { label: "Reports" },
      ],
    };
  if (role === "KAM")
    return { badge: "KAM", suffix: "KAM", items: [{ label: "Client liability", href: "/kam", match: ["/kam", "/cases"] }] };
  if (role === "ADMIN")
    return {
      badge: "ADMIN",
      suffix: "Admin",
      items: [
        { label: "OPS", href: "/ops", match: ["/ops"] },
        { label: "Accounts", href: "/accounts", match: ["/accounts"] },
        { label: "Management", href: "/management", match: ["/management"] },
      ],
    };
  return {
    badge: "INTERNAL OPS",
    suffix: "SD OPS",
    items: [
      { label: "Dashboard" }, { label: "Orders" }, { label: "NDR" },
      { label: "Lost & Damage", href: "/ops", match: ["/ops", "/cases"] },
      { label: "Reports" },
    ],
  };
}

export function TopNav({ role, name, pending }: { role: string; name?: string; pending: number }) {
  const path = usePathname() ?? "";
  const { badge, items, suffix } = itemsFor(role, pending);
  // On the Management side "/management/approvals" must not also light up "/management".
  const active = (i: Item) => {
    if (!i.href) return false;
    if (role === "MANAGEMENT") return i.href === "/management/approvals" ? path.startsWith("/management/approvals") : !path.startsWith("/management/approvals");
    return (i.match ?? [i.href]).some((m) => path === m || path.startsWith(m + "/"));
  };
  return (
    <header className="topbar">
      <Link href="/" className="brand" style={{ textDecoration: "none" }}>InstaLogix</Link>
      {name && <span className="role-badge">{badge}</span>}
      <nav className="nav">
        {name &&
          items.map((i) =>
            i.href ? (
              <Link key={i.label} href={i.href} className={active(i) ? "on" : ""}>
                {i.label}
                {i.count ? <span className="count">{i.count}</span> : null}
              </Link>
            ) : (
              <span key={i.label} className="off" title={OFF}>{i.label}</span>
            ),
          )}
      </nav>
      <div className="who">{name ? `${name} · ${suffix}` : "Not signed in"}</div>
    </header>
  );
}
