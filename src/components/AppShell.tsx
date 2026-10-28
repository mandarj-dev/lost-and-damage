"use client";
// Figma shell: white left sidebar (brand, role nav, user, role switcher) + content. Role/token come from the dev sign-in (localStorage).
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api, getToken, setRole, signOut, type ApiRole } from "@/lib/api";
import { API_ROLES, ROLE_HOME, useRole } from "./ApiKit";

type Sub = { label: string; href: string; count?: number; match?: string[] };
const I = {
  truck: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1.5 4h8v7h-8zM9.5 6.5h3l2 2.5V11h-5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><circle cx="4.5" cy="12" r="1.3" stroke="currentColor"/><circle cx="12" cy="12" r="1.3" stroke="currentColor"/></svg>,
  doc: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 1.5h5.5L12.5 4.5v10h-8.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M6 8h4.5M6 10.5h4.5" stroke="currentColor" strokeWidth="1.2"/></svg>,
  box: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l6 3v7l-6 3-6-3v-7z M2 4.5l6 3 6-3M8 7.5v7" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  user: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.3"/><path d="M1.5 14c.5-3 2.3-4.5 4.5-4.5S10 11 10.5 14M11 7.5l1.5 1.5 2.5-3" stroke="currentColor" strokeWidth="1.3"/></svg>,
  card: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="3" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M1.5 6.5h13" stroke="currentColor" strokeWidth="1.3"/></svg>,
  gear: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" strokeWidth="1.3"/></svg>,
};
const off = (label: string, icon: ReactNode) => ({ label, icon });

function navFor(role: ApiRole, pending: number, unsettled: number) {
  if (role === "ACCOUNTS") return { brand: "Smart Finance", sub: "Accounts", user: "SD Accounts",
    before: [off("Pending Bills", I.doc), off("Shipment Tracking", I.truck), off("CN/DN Management", I.card)],
    subs: [{ label: "Client CN release", href: "/accounts", match: ["/accounts", "/cases"] }, { label: "Courier settlements", href: "/accounts/settlements", count: unsettled }, { label: "Liability masters", href: "/accounts/liability" }, { label: "Bulk update logs", href: "/accounts/bulk" }] as Sub[],
    after: [off("Client Master", I.user), off("Reports", I.doc), off("Rate Card Configuration", I.gear)] };
  if (role === "MANAGEMENT") return { brand: "InstaLogix", sub: "Management", user: "Management",
    before: [off("Shipment Tracking", I.truck)],
    subs: [{ label: "Dashboard", href: "/management", match: ["/management", "/cases"] }, { label: "Approvals", href: "/management/approvals", count: pending }] as Sub[],
    after: [off("Reports", I.doc)] };
  if (role === "KAM") return { brand: "InstaLogix", sub: "Key accounts", user: "KAM",
    before: [off("Shipment Tracking", I.truck), off("My clients", I.user)],
    subs: [{ label: "Client liability", href: "/kam", match: ["/kam", "/cases"] }, { label: "Mark shipment", href: "/ops/new" }] as Sub[],
    after: [off("Reports", I.doc)] };
  return { brand: "InstaLogix", sub: "Internal OPS", user: "SD OPS",
    before: [off("Shipment Tracking", I.truck), off("NDR", I.doc)],
    subs: [{ label: "Cases", href: "/ops", match: ["/ops", "/cases"] }, { label: "Bulk update logs", href: "/ops/bulk" }] as Sub[],
    after: [off("Reports", I.doc), off("Client Master", I.user)] };
}

export function AppShell({ children }: { children: ReactNode }) {
  const role = useRole();
  const path = usePathname();
  const router = useRouter();
  const [pending, setPending] = useState(0);
  const [unsettled, setUnsettled] = useState(0);
  useEffect(() => {
    setPending(0); setUnsettled(0);
    if (role === "MANAGEMENT") Promise.all([api.approvals({ tab: "approvals" }), api.approvals({ tab: "escalations" })]).then(([a, e]) => setPending((a?.total ?? 0) + (e?.total ?? 0))).catch(() => {});
    if (role === "ACCOUNTS") api.courierCns({ settlement_state: "UNSETTLED" }).then((d) => setUnsettled(d?.total ?? 0)).catch(() => {});
  }, [role]);
  if (!role || path === "/") return <>{children}</>;
  const n = navFor(role, pending, unsettled);
  const subOn = (s: Sub) => (s.match ?? [s.href]).some((m) => (m === s.href ? path === m : path.startsWith(m)));
  const pick = n.subs.find((s) => s.href === path) ?? n.subs.find(subOn);
  return (
    <div className="shell">
      <aside className="side">
        <div className="side-brand"><b>{n.brand}</b><span>{n.sub}</span></div>
        <nav className="side-nav">
          {n.before.map((i) => <span key={i.label} className="side-item off" title="Outside this module">{i.icon}{i.label}</span>)}
          <span className="side-item grp">{I.box}Lost &amp; Damage<svg style={{ marginLeft: "auto" }} width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" stroke="currentColor" fill="none" strokeWidth="1.3"/></svg></span>
          {n.subs.map((s) => <Link key={s.href} href={s.href} className={`side-sub${pick === s ? " on" : ""}`}>{s.label}{!!s.count && <span className="cnt">{s.count}</span>}</Link>)}
          {n.after.map((i) => <span key={i.label} className="side-item off" title="Outside this module">{i.icon}{i.label}</span>)}
        </nav>
        <div className="side-user"><div className="av">{role.slice(0, 2)}</div><div><b>Dev {role.toLowerCase()}</b><span>{n.user}</span></div></div>
        <div className="side-switch">
          <select value={role} onChange={(e) => { const r = e.target.value as ApiRole; setRole(r); router.push(ROLE_HOME[r]); }} aria-label="Switch role">
            {API_ROLES.map((r) => <option key={r} value={r} disabled={!getToken(r)}>{r}{getToken(r) ? "" : " (no token)"}</option>)}
          </select>
          <button className="btn btn-sm" onClick={() => router.push("/")}>Tokens</button>
          <button className="btn btn-sm" onClick={() => { signOut(); router.push("/"); }}>Out</button>
        </div>
        <div className="side-foot">v1.0.0 | © 2026 ShipDelight</div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
