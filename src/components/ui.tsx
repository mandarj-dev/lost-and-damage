// Small presentational components shared by every screen (server-safe: no hooks).
import Link from "next/link";
import type { ReactNode } from "react";
import { fileKind, type Chip as ChipData, type Tone } from "@/lib/case-view";

/** Build a URL from a path and the current search params, applying `patch` (undefined/"" removes a key). */
export function href(path: string, current: Record<string, string | undefined>, patch: Record<string, string | undefined> = {}) {
  const next = { ...current, ...patch };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
}

export function Chip({ tone = "grey", children, sq, lg }: { tone?: Tone; children: ReactNode; sq?: boolean; lg?: boolean }) {
  return <span className={`chip ${tone}${sq ? " sq" : ""}${lg ? " lg" : ""}`}>{children}</span>;
}

/** Ticket-status chip with its sub-line, as in the list tables. */
export function TicketChip({ chip }: { chip: ChipData }) {
  return (
    <div>
      <Chip tone={chip.tone}>{chip.label}</Chip>
      {chip.sub && <div className={`sub ${chip.subTone ?? ""}`}>{chip.sub}</div>}
    </div>
  );
}

export const TypeTag = ({ type }: { type: string }) =>
  type === "LOST" ? <span className="tag-lost">Lost</span> : <span className="tag-dmg">Damaged</span>;

export const TypeTagCaps = ({ type }: { type: string }) =>
  type === "LOST" ? <span className="tag-lost">LOST</span> : <span className="tag-dmg">DAMAGED</span>;

/** Manual / API source pill. Accounts sees OPS/API, OPS sees Manual / API · view only. */
export function SourcePill({ source, view }: { source: string; view: "ops" | "accounts" }) {
  if (source === "API") return view === "ops" ? <span className="chip grey">API · view only</span> : <span className="chip blue">API</span>;
  return view === "ops" ? <span className="chip teal">Manual</span> : <span className="chip teal">OPS</span>;
}

export function Kpi({
  label, value, sub, tone, href: to, selected, alert, children,
}: {
  label: string;
  value?: ReactNode;
  sub?: ReactNode;
  tone?: "green" | "orange" | "red" | "teal" | "purple";
  href?: string;
  selected?: boolean;
  alert?: boolean;
  children?: ReactNode;
}) {
  const cls = `kpi${selected ? " sel" : ""}${alert ? " alert" : ""}`;
  const body = (
    <>
      <div className="k-label">{label}</div>
      {value !== undefined && <div className={`k-value${tone ? ` t-${tone}` : ""}`}>{value}</div>}
      {children}
      {sub && <div className="k-sub">{sub}</div>}
    </>
  );
  return to ? <Link href={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function MainTabs({ items }: { items: { href: string; label: string; count?: number; note?: string; on: boolean }[] }) {
  return (
    <div className="tabs">
      {items.map((t) => (
        <Link key={t.label} href={t.href} className={`tab${t.on ? " on" : ""}`}>
          {t.label}
          {t.count !== undefined && <span className="pill">{t.count.toLocaleString("en-IN")}</span>}
          {t.note && <span className="note">{t.note}</span>}
        </Link>
      ))}
    </div>
  );
}

export function SubTabs({ items }: { items: { href: string; label: string; count: number; on: boolean }[] }) {
  return (
    <div className="subtabs">
      {items.map((t) => (
        <Link key={t.label} href={t.href} className={`subtab${t.on ? " on" : ""}`}>
          {t.label}
          <span className="pill">{t.count.toLocaleString("en-IN")}</span>
        </Link>
      ))}
    </div>
  );
}

export function Segmented({ items }: { items: { href: string; label: string; on: boolean }[] }) {
  return (
    <div className="seg">
      {items.map((s) => (
        <Link key={s.label} href={s.href} className={s.on ? "on" : ""}>{s.label}</Link>
      ))}
    </div>
  );
}

export function Pager({ page, total, pageSize, makeHref, noun = "" }: { page: number; total: number; pageSize: number; makeHref: (p: number) => string; noun?: string }) {
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const nums = Array.from({ length: Math.min(pages, 5) }, (_, i) => {
    const start = Math.min(Math.max(page - 2, 1), Math.max(pages - 4, 1));
    return start + i;
  });
  return (
    <div className="pager">
      <span>
        Showing {from}–{to} of {total.toLocaleString("en-IN")}
        {noun}
      </span>
      <div className="pages">
        {nums.map((n) => (n === page ? <span key={n} className="on">{n}</span> : <Link key={n} href={makeHref(n)}>{n}</Link>))}
        {page < pages && <Link href={makeHref(page + 1)}>Next</Link>}
      </div>
    </div>
  );
}

export function Banner({ tone, children, icon = true }: { tone: "red" | "amber" | "grey" | "green" | "purple"; children: ReactNode; icon?: boolean }) {
  return (
    <div className={`banner ${tone}`}>
      {icon && tone !== "grey" && (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flex: "none", marginTop: 1 }} aria-hidden>
          <path d="M9 2l7.5 13h-15L9 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M9 7v4M9 13v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
      <div>{children}</div>
    </div>
  );
}

export const FileType = ({ name }: { name: string }) => <span className={`ftype ${fileKind(name)}`}>{fileKind(name)}</span>;

export function Crumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <div className="crumbs">
      {items.map((c, i) => (
        <span key={c.label}>
          {i > 0 && " / "}
          {c.href ? <Link href={c.href}>{c.label}</Link> : c.label}
        </span>
      ))}
    </div>
  );
}

export function PageHead({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>{children}<h1 className="page-title">{title}</h1></div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className}`}>
      <div className="lbl">{label}</div>
      {children}
    </div>
  );
}

export const UploadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M8 11V3M5 6l3-3 3 3M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M8 3v8M5 8l3 3 3-3M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const LockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><rect x="2" y="5.5" width="8" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" /><path d="M4 5.5V4a2 2 0 014 0v1.5" stroke="currentColor" strokeWidth="1.2" /></svg>
);
export const InfoIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden><circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" /><path d="M7 6v4M7 4v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
);
