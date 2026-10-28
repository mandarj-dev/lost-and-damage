"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useEffect } from "react";
import { InfoIcon } from "./ui";
import { fmtDay } from "@/lib/dates";

const fmt = (iso: string) => fmtDay(`${iso}T00:00:00Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Date-range button with presets and custom dates. Writes `from` / `to` into the URL. */
export function DateRange({ from, to, onApply, label = "Marked date", align = "left", bare, preset: presetLabel }: {
  from?: string; to?: string; onApply: (from?: string, to?: string) => void; label?: string; align?: "left" | "right"; bare?: boolean; preset?: string;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(from ?? "");
  const [t, setT] = useState(to ?? "");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const preset = (days: number | null) => {
    const end = new Date();
    onApply(days === null ? undefined : isoDay(new Date(end.getTime() - days * 86_400_000)), days === null ? undefined : isoDay(end));
    setOpen(false);
  };
  const range = from || to ? `${from ? fmt(from) : "Start"} – ${to ? fmt(to) : "today"}` : "All dates";
  const text = presetLabel ? `${presetLabel} · ${range}` : range;
  return (
    <div className="field" style={{ position: "relative" }} ref={box}>
      {!bare && <div className="lbl">{label}</div>}
      <button type="button" className="input" style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", minWidth: 250 }} onClick={() => setOpen(!open)}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="#5b6170" strokeWidth="1.3" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="#5b6170" strokeWidth="1.3" /></svg>
        <span style={{ flex: 1 }}>{text}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M2 4l4 4 4-4" stroke="#5b6170" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="card" style={{ position: "absolute", top: bare ? 46 : 70, [align]: 0, zIndex: 30, padding: 14, width: 290, boxShadow: "0 8px 24px rgba(15,42,51,.18)" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {[["Last 7 days", 7], ["Last 30 days", 30], ["Last 90 days", 90]].map(([l, d]) => (
              <button key={l as string} type="button" className="btn btn-sm" style={{ height: 28 }} onClick={() => preset(d as number)}>{l}</button>
            ))}
            <button type="button" className="btn btn-sm" style={{ height: 28 }} onClick={() => preset(null)}>All dates</button>
          </div>
          <div className="grid2">
            <div className="field"><div className="lbl">From</div><input className="input" type="date" value={f} onChange={(e) => setF(e.target.value)} /></div>
            <div className="field"><div className="lbl">To</div><input className="input" type="date" value={t} onChange={(e) => setT(e.target.value)} /></div>
          </div>
          <button type="button" className="btn btn-primary" style={{ width: "100%", marginTop: 12, height: 36 }} onClick={() => { onApply(f || undefined, t || undefined); setOpen(false); }}>Apply</button>
        </div>
      )}
    </div>
  );
}

export interface FilterConfig {
  /** "ops" shows Ticket status + Source; "accounts" shows the search-type select + Source + Client dues. */
  variant: "ops" | "accounts";
  viewBy: string[]; // e.g. ["Courier","Client","AWB"]
  hint?: string;
}

/** Filter row of the case lists. Every control writes into the URL, so views are shareable and the server renders them. */
export function ListFilters({ variant, viewBy, hint }: FilterConfig) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const get = (k: string) => sp.get(k) ?? "";
  const [q, setQ] = useState(get("q"));
  useEffect(() => setQ(get("q")), [sp]); // eslint-disable-line react-hooks/exhaustive-deps

  const push = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    next.delete("page");
    router.push(`${path}?${next.toString()}`);
  };
  const view = (get("view") || viewBy[0]).toLowerCase();

  return (
    <>
      <div className="filters">
        <div className="field">
          <div className="lbl">View by</div>
          <div className="seg">
            {viewBy.map((v) => (
              <button key={v} type="button" className={view === v.toLowerCase() ? "on" : ""} onClick={() => push({ view: v.toLowerCase() === viewBy[0].toLowerCase() ? undefined : v.toLowerCase() })}>{v}</button>
            ))}
          </div>
        </div>
        {variant === "ops" ? (
          <div className="field grow">
            <div className="lbl">Search AWB / Order no.</div>
            <input className="input" placeholder="Paste one or many, comma-separated" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && push({ q: q.trim() || undefined })} onBlur={() => q.trim() !== get("q") && push({ q: q.trim() || undefined })} />
          </div>
        ) : (
          <div className="field grow">
            <div className="lbl">Search</div>
            <div className="search-combo">
              <select className="select" aria-label="Search by" defaultValue="awb"><option value="awb">AWB / Order no.</option><option value="cn">Courier CN no.</option><option value="brand">Brand CN no.</option></select>
              <input className="input" placeholder="Paste one or many AWB or order numbers" value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && push({ q: q.trim() || undefined })} onBlur={() => q.trim() !== get("q") && push({ q: q.trim() || undefined })} />
            </div>
          </div>
        )}
        <DateRange from={get("from") || undefined} to={get("to") || undefined} onApply={(f, t) => push({ from: f, to: t })} />
        {variant === "ops" && (
          <div className="field" style={{ width: 140 }}>
            <div className="lbl">Ticket status</div>
            <select className="select" value={get("ticket")} onChange={(e) => push({ ticket: e.target.value || undefined })}>
              <option value="">All open</option><option value="open">Open</option><option value="claim">Claim raised</option><option value="followup">Follow-up</option>
              <option value="rejected">CN rejected</option><option value="escalated">Escalated</option><option value="returned">Returned</option>
            </select>
          </div>
        )}
        <div className="field" style={{ width: variant === "ops" ? 170 : 140 }}>
          <div className="lbl">Source</div>
          <select className="select" value={get("source")} onChange={(e) => push({ source: e.target.value || undefined })}>
            <option value="">All</option><option value="MANUAL">{variant === "ops" ? "Manual" : "OPS-marked"}</option><option value="API">API</option>
          </select>
        </div>
        {variant === "accounts" && (
          <div className="field" style={{ width: 170 }}>
            <div className="lbl">Client dues</div>
            <select className="select" value={get("dues")} onChange={(e) => push({ dues: e.target.value || undefined })}>
              <option value="">All</option><option value="gt30">Dues &gt; 30 d</option>
            </select>
          </div>
        )}
      </div>
      {hint && <div className="hint"><InfoIcon />{hint}</div>}
    </>
  );
}
