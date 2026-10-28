"use client";
// Shared client widgets for the live-backend screens. Reuses the existing design-system classes (globals.css).
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { API_ROLES, api, getRole, type ApiRole, type EvidenceFile, type Row } from "@/lib/api";
import { Banner } from "./ui";

export function useRole() {
  const [role, set] = useState<ApiRole | null | undefined>(undefined);
  useEffect(() => {
    const sync = () => set(getRole());
    sync();
    window.addEventListener("ld-auth", sync);
    return () => window.removeEventListener("ld-auth", sync);
  }, []);
  return role;
}

/** Load data from the backend; re-runs when deps change. */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setData(null); // drop the previous deps' response so it never renders in the wrong view
    setLoading(true);
    setError(null);
    fn().then((d) => live && setData(d)).catch((e: Error) => live && setError(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Renders children only when the selected dev role is one of `roles`. */
export function RoleGate({ roles, children }: { roles: ApiRole[]; children: ReactNode }) {
  const role = useRole();
  if (role === undefined) return <div className="page"><p className="note-sm">Loading…</p></div>;
  if (!role || !roles.includes(role))
    return (
      <div className="page" style={{ maxWidth: 640 }}>
        <Banner tone="amber">This screen needs role {roles.join(" / ")}. <Link href="/" className="link">Pick a role and paste its token</Link>.</Banner>
      </div>
    );
  return <>{children}</>;
}

export const Status = ({ loading, error }: { loading: boolean; error: string | null }) =>
  error ? <p className="errline">{error}</p> : loading ? <p className="note-sm">Loading from backend…</p> : null;

export const fmt = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString("en-IN");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  if (typeof v === "object") return Array.isArray(v) ? `${v.length} item(s)` : (v as Row).name ?? (v as Row).label ?? JSON.stringify(v).slice(0, 60);
  return String(v);
};
export const inr = (v: unknown) => (typeof v === "number" ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : fmt(v));
export const rowId = (r: Row) => String(r._id ?? r.id ?? r.dispute_id ?? "");

export type Col = { key: string; label: string; render?: (r: Row) => ReactNode };
/** Table in the existing .tbl style. Columns that are absent from every row are hidden. */
export function DataTable({ rows, cols, select, empty = "Nothing here" }: { rows: Row[]; cols: Col[]; select?: { ids: string[]; set: (ids: string[]) => void }; empty?: string }) {
  const shown = cols.filter((c) => c.render || rows.some((r) => r[c.key] !== undefined));
  if (!rows.length) return <div className="empty">{empty}</div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            {select && <th className="cb"><input type="checkbox" checked={select.ids.length === rows.length} onChange={(e) => select.set(e.target.checked ? rows.map(rowId) : [])} /></th>}
            {shown.map((c) => <th key={c.key}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowId(r) || i}>
              {select && (
                <td className="cb">
                  <input type="checkbox" checked={select.ids.includes(rowId(r))} onChange={(e) => select.set(e.target.checked ? [...select.ids, rowId(r)] : select.ids.filter((x) => x !== rowId(r)))} />
                </td>
              )}
              {shown.map((c) => <td key={c.key}>{c.render ? c.render(r) : /amount|liability|value|gap|claim/i.test(c.key) ? inr(r[c.key]) : fmt(r[c.key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SimplePager({ page, total, pageSize, set }: { page: number; total: number; pageSize: number; set: (p: number) => void }) {
  const pages = Math.max(Math.ceil(total / (pageSize || 50)), 1);
  return (
    <div className="pager">
      <span>Page {page} of {pages} · {total.toLocaleString("en-IN")} total</span>
      <div className="pages">
        {page > 1 && <a onClick={() => set(page - 1)} style={{ cursor: "pointer" }}>Prev</a>}
        <span className="on">{page}</span>
        {page < pages && <a onClick={() => set(page + 1)} style={{ cursor: "pointer" }}>Next</a>}
      </div>
    </div>
  );
}

/** File picker that uploads to POST /uploads and returns EvidenceFile refs. */
export function Uploader({ disputeId, value, onChange, max = 5 }: { disputeId?: string; value: EvidenceFile[]; onChange: (f: EvidenceFile[]) => void; max?: number }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <input type="file" multiple disabled={busy || value.length >= max} accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.eml"
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []).slice(0, max - value.length);
          if (!files.length) return;
          setBusy(true); setErr(null);
          try { onChange([...value, ...(await api.upload(files, disputeId))]); } catch (x) { setErr((x as Error).message); }
          setBusy(false); e.target.value = "";
        }} />
      {busy && <span className="note-sm"> Uploading…</span>}
      {value.map((f) => <div key={f.key} className="note-sm">📎 {f.name} <a className="link" onClick={() => onChange(value.filter((x) => x.key !== f.key))}>remove</a></div>)}
      {err && <p className="errline">{err}</p>}
    </div>
  );
}

export const ROLE_HOME: Record<ApiRole, string> = { OPS: "/ops", ACCOUNTS: "/accounts", MANAGEMENT: "/management", KAM: "/kam" };
export { API_ROLES };
