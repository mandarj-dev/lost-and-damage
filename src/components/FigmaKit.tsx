"use client";
// Presentational pieces matching the final Figma, bound to rows from the live backend.
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { api, type EvidenceFile, type Row } from "@/lib/api";
import { rowId } from "./ApiKit";

export const rs = (v: unknown) => (typeof v === "number" && isFinite(v) ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—");
/** Liability cell: "COF" when that side is COF only (cost of freight, no amount), muted "Not defined" when the master has no liability (null), else the amount. */
export const liab = (v: unknown, format: (value: unknown) => string = rs, isCofOnly?: unknown): ReactNode =>
  isCofOnly === true ? <span className="chip">COF</span> : v === null || v === undefined ? <span className="muted">Not defined</span> : format(v);
export const nf = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-IN") : "—");
export const awbOf = (r: Row) => String(r.airwabilno ?? r.airwaybilno ?? "—");
export const dayMon = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—");
export const dayFull = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
export const ageDays = (v: unknown) => (v ? Math.max(0, Math.floor((Date.now() - new Date(String(v)).getTime()) / 86_400_000)) : null);
export const sum = (rows: Row[] | undefined, k: string) => (rows ?? []).reduce((s, r) => s + (typeof r[k] === "number" ? r[k] : 0), 0);
export const clientOf = (r: Row) => r.client_name ?? r.tenant_id ?? "—";
/** Readable courier name: underscores become spaces, each word's first letter capitalised, rest kept (shree maruti v3 -> Shree Maruti V3). */
export const courierLabel = (name?: string | null) => (name ? name.replace(/_/g, " ").split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : undefined);
export const courierOf = (r: Row) => r.courier_label ?? courierLabel(r.courier_name) ?? r.courier_code ?? "—";
export const byOf = (s: Row | undefined) => (s?.name ? `by ${s.name}${s.role ? ` (${s.role})` : ""}` : "");

const STATUS: Record<string, [string, string]> = {
  MARKED: ["Open", "grey"], CLAIM_RAISED: ["Claim raised", "amber"], FOLLOW_UP: ["Follow-up", "amber"], COURIER_REJECTED: ["CN rejected", "red"],
  COURIER_CN_RECEIVED: ["CN received", "green"], PENDING_APPROVAL: ["With management", "purple"], ESCALATED: ["Escalated", "purple"],
  APPROVED_FOR_RELEASE: ["Approved for release", "green"], CLIENT_CN_RELEASED: ["Released", "blue"], CLOSED: ["Closed", "grey"],
};
export const StatusChip = ({ s }: { s?: string }) => { const [l, t] = STATUS[s ?? ""] ?? [s ?? "—", "grey"]; return <span className={`chip ${t}`}>{l}</span>; };
export const SourceChip = ({ s }: { s?: string }) => <span className={`chip ${s === "API" ? "grey" : "blue"}`}>{s === "API" ? "API" : "Manual"}</span>;
export const TypeTag = ({ t }: { t?: string }) => (t === "DAMAGED" ? <span className="tag-dmg">DAMAGED</span> : <span className="tag-lost">LOST</span>);

/** Sub-line under the ticket status: claim window if close, else the last update text. */
export function ticketSub(r: Row): ReactNode {
  if (typeof r.days_left === "number" && r.is_open !== false && ["MARKED", "CLAIM_RAISED", "FOLLOW_UP"].includes(r.status))
    return <div className={`sub${r.days_left <= 7 ? " red" : ""}`}>Claim window: {r.days_left} days left</div>;
  return r.last_update?.text ? <div className="sub">{r.last_update.text}</div> : null;
}

export const Ico = {
  layers: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  card: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3.5" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M2 7h12M4.5 10h3" stroke="currentColor" strokeWidth="1.3"/></svg>,
  check: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  clock: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/><path d="M8 5v3.3l2 1.5" stroke="currentColor" strokeWidth="1.3"/></svg>,
  truck: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1.5 4h8v7h-8zM9.5 6.5h3l2 2.5V11h-5" stroke="currentColor" strokeWidth="1.3"/></svg>,
  person: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.3"/><path d="M3 14c.6-3 2.6-4.5 5-4.5s4.4 1.5 5 4.5" stroke="currentColor" strokeWidth="1.3"/></svg>,
  cal: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M2 6.5h12M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.3"/></svg>,
  down: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v8M5 8l3 3 3-3M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  up: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 11V3M5 6l3-3 3 3M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  plus: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>,
  eye: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" stroke="currentColor" strokeWidth="1.3"/><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/></svg>,
  file: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 1.5h5.5L12.5 4.5v10h-8.5z" stroke="currentColor" strokeWidth="1.3"/></svg>,
};

/** KPI card from the Figma: uppercase label, icon tile, big value, sub-line. `value === undefined` renders the card empty (data not available). */
export function KpiCard({ label, value, sub, icon, ico, tone, hot }: { label: string; value?: ReactNode; sub?: ReactNode; icon?: ReactNode; ico?: string; tone?: string; hot?: boolean }) {
  const na = value === undefined || value === null;
  return (
    <div className={`kpi${hot ? " hot" : ""}${na ? " na" : ""}`}>
      <div className="k-label">{label}</div>
      {icon && <div className={`k-ico ${ico ?? ""}`}>{icon}</div>}
      <div className={`k-value${tone ? ` t-${tone}` : ""}`}>{na ? "—" : value}</div>
      <div className="k-sub">{na ? <span className="na-note">Not available from the backend yet</span> : sub}</div>
    </div>
  );
}

export function PTabs<T extends string>({ items, value, set, hint }: { items: { v: T; label: string; n?: number }[]; value: T; set: (v: T) => void; hint?: string }) {
  return (
    <div className="ptabs">
      {items.map((t) => <button key={t.v} className={`ptab${t.v === value ? " on" : ""}`} onClick={() => set(t.v)}>{t.label}{t.n !== undefined && <span className="n">{nf(t.n)}</span>}</button>)}
      {hint && <span className="hint2">{hint}</span>}
    </div>
  );
}
export function SubTabsF<T extends string | undefined>({ items, value, set }: { items: { v: T; label: string; n?: number }[]; value: T; set: (v: T) => void }) {
  return <div className="subtabs">{items.map((t) => <a key={String(t.v)} className={`subtab${t.v === value ? " on" : ""}`} onClick={() => set(t.v)}>{t.label}{t.n !== undefined && <span className="pill">{nf(t.n)}</span>}</a>)}</div>;
}
export function Seg<T extends string>({ items, value, set }: { items: { v: T; label: string }[]; value: T; set: (v: T) => void }) {
  return <div className="seg">{items.map((s) => <button key={s.v} className={s.v === value ? "on" : ""} onClick={() => set(s.v)}>{s.label}</button>)}</div>;
}
export const F = ({ label, grow, children }: { label: string; grow?: boolean; children: ReactNode }) => <label className={`f${grow ? " grow" : ""}`}>{label}{children}</label>;

export function Head({ crumbs, title, actions, back }: { crumbs: string; title: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="page-head">
      <div>
        <div style={{ display: "flex", alignItems: "center" }}>
          {back && <Link className="back" href={back.href}>‹ {back.label}</Link>}
          <div className="crumbs">{crumbs}</div>
        </div>
        <h1 className="page-title">{title}</h1>
      </div>
      {actions && <div className="page-actions" style={{ display: "flex", gap: 10 }}>{actions}</div>}
    </div>
  );
}

export function Pager({ page, total, pageSize, set, noun }: { page: number; total: number; pageSize: number; set: (p: number) => void; noun: string }) {
  const pages = Math.max(Math.ceil(total / (pageSize || 50)), 1);
  const nums = Array.from({ length: Math.min(pages, 3) }, (_, i) => Math.min(Math.max(page - 1, 1), Math.max(pages - 2, 1)) + i);
  return (
    <div className="pager">
      <span>Showing {Math.min(total, page * pageSize) - (total ? (page - 1) * pageSize : 0)} of {nf(total)} {noun}</span>
      <div className="pages">
        {nums.map((n) => (n === page ? <span key={n} className="on">{n}</span> : <a key={n} onClick={() => set(n)} style={{ cursor: "pointer" }}>{n}</a>))}
        {page < pages && <a onClick={() => set(page + 1)} style={{ cursor: "pointer" }}>Next</a>}
      </div>
    </div>
  );
}

/** Drag-and-drop uploader from the Figma drawers; uploads through POST /uploads and returns EvidenceFile refs. */
export function DropUpload({ value, onChange, disputeId, max = 5, hint, label = "Attachments", required = true }: { value: EvidenceFile[]; onChange: (f: EvidenceFile[]) => void; disputeId?: string; max?: number; hint?: string; label?: string; required?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const add = async (list: FileList | null) => {
    const files = Array.from(list ?? []).slice(0, max - value.length);
    if (!files.length) return;
    setBusy(true); setErr(null);
    try { onChange([...value, ...(await api.upload(files, disputeId))]); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", margin: "4px 0 8px" }}>
        <b style={{ fontSize: 13 }}>{label}{required && <span className="req">Required</span>}</b>
        <span className="note-sm">PDF, JPEG, PNG · 10 MB each · up to {max}</span>
      </div>
      {value.length < max && (
        <div className="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}>
          <div className="big">{busy ? "Uploading…" : "Drag and drop your files"}</div>
          {hint && <div className="small">{hint}</div>}
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => ref.current?.click()}>Select file</button>
          <input ref={ref} type="file" hidden multiple={max > 1} accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.eml" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        </div>
      )}
      {value.map((f) => (
        <div key={f.key} className="fileline"><span className="chip red">{(f.name.split(".").pop() ?? "").toUpperCase()}</span><span style={{ flex: 1 }}>{f.name} · {Math.round(f.size / 1024)} KB</span>
          <button type="button" className="x" style={{ border: 0, background: "none" }} onClick={() => onChange(value.filter((x) => x.key !== f.key))}>×</button></div>
      ))}
      {err && <p className="errline">{err}</p>}
    </div>
  );
}

/** AWB-level case table (OPS / Accounts / KAM column sets from the Figma). */
export function CaseTable({ rows, variant, ids, setIds, onUpdate, onRelease }: { rows: Row[]; variant: "ops" | "accounts" | "kam" | "mgmt"; ids: string[]; setIds?: (v: string[]) => void; onUpdate?: (r: Row) => void; onRelease?: (r: Row) => void }) {
  if (!rows.length) return <div className="empty" style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>No cases match these filters</div>;
  const sel = !!setIds;
  const tick = (r: Row) => sel && <td className="cb"><input type="checkbox" checked={ids.includes(rowId(r))} onChange={(e) => setIds!(e.target.checked ? [...ids, rowId(r)] : ids.filter((x) => x !== rowId(r)))} /></td>;
  const awb = (r: Row, pill?: boolean) => <td><div className="mono strong">{awbOf(r)}</div><div className="sub">{r.orderno ?? ""}</div>{pill && <div style={{ marginTop: 4 }}><SourceChip s={r.source} /></div>}</td>;
  const marked = (r: Row) => <><div className="sub" style={{ color: (ageDays(r.created_at) ?? 0) > 15 ? "var(--red)" : undefined }}>{dayMon(r.created_at)} · {ageDays(r.created_at) ?? "—"} d</div><div className="sub">{byOf(r.marked)}</div></>;
  const view = (r: Row) => <Link className="vlink" href={`/cases/${rowId(r)}`}>View {Ico.eye}</Link>;
  const head = sel ? <th className="cb"><input type="checkbox" checked={ids.length === rows.length} onChange={(e) => setIds!(e.target.checked ? rows.map(rowId) : [])} /></th> : null;
  if (variant === "accounts")
    return (
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr>{head}<th>AWB · Order</th><th>Client · Courier</th><th>Status</th><th className="num">Item / Client ₹</th><th>Courier CN</th><th className="num">SD gap</th><th>Settlement</th><th>Action</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={rowId(r) || `row-${i}`}>{tick(r)}{awb(r, true)}
            <td><div>{clientOf(r)}</div><div className="sub">{courierOf(r)}</div></td>
            <td><StatusChip s={r.status} />{marked(r)}</td>
            <td className="num"><div className="liab"><span>Item</span><b>{nf(r.invoice_amount)}</b><span>Client</span><b className="strong">{liab(r.client_liability, nf, r.client_cof_only)}</b></div></td>
            <td><div className="strong">{rs(r.courier_cn_amount)}</div></td>
            <td className="num"><span className={r.sd_gap ? "t-orange strong" : ""}>{rs(r.sd_gap)}</span></td>
            <td><span className="na-note">—</span></td>
            <td><div className="act">{view(r)}{onRelease && <button className="btn btn-sm btn-primary" onClick={() => onRelease(r)}>Release</button>}</div></td>
          </tr>))}</tbody>
      </table></div>
    );
  return (
    <div className="tbl-wrap"><table className="tbl">
      <thead><tr>{head}<th>AWB · Order</th><th>Client</th><th>Courier</th><th>Status · Marked</th><th>Liability (₹)</th><th>Ticket status</th><th>Action</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={rowId(r) || `row-${i}`}>{tick(r)}{awb(r)}
          <td>{clientOf(r)}</td>
          <td>{variant === "kam" ? <span>{courierOf(r)}</span> : courierOf(r)}</td>
          <td><div style={{ display: "flex", gap: 6 }}><TypeTag t={r.case_type} /><SourceChip s={r.source} /></div>{marked(r)}</td>
          <td><div className="liab"><span>Item</span><b>{nf(r.invoice_amount)}</b><span>Client</span><b>{liab(r.client_liability, nf, r.client_cof_only)}</b>{variant !== "kam" && <><span>Courier</span><b className={r.courier_liability != null && r.client_liability != null && r.courier_liability < r.client_liability ? "t-orange" : ""}>{liab(r.courier_liability, nf, r.courier_cof_only)}</b></>}</div></td>
          <td><StatusChip s={r.status} />{ticketSub(r)}</td>
          <td><div className="act">{view(r)}{onUpdate && <button className="btn btn-sm btn-primary" onClick={() => onUpdate(r)}>Update</button>}</div></td>
        </tr>))}</tbody>
    </table></div>
  );
}
