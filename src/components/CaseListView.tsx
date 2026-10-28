"use client";
// Shared list body for OPS / Accounts / KAM / Management: filters, group (courier/client) table or AWB CaseTable, paging and drawers.
import { useEffect, useId, useState, type ReactNode } from "react";
import { api, type DisputeListQuery, type Row } from "@/lib/api";
import { Status, rowId, useApi } from "./ApiKit";
import { ApprovalDrawer, ReleaseDrawer, UpdateStatusDrawer } from "./FigmaDrawers";
import { CaseTable, F, Pager, Seg, SubTabsF, nf, rs, sum } from "./FigmaKit";

type View = "courier" | "client" | "awb";
type Opt = { v: string; label: string };

/** Client and courier dropdown options, loaded once per page from GET /filters/options. */
export function useFilterOptions() {
  const res = useApi(() => api.filterOptions(), []);
  const clients: Opt[] = (res.data?.clients ?? []).map((c) => ({ v: c.tenant_id, label: c.client_name }));
  const couriers: Opt[] = (res.data?.couriers ?? []).map((c) => ({ v: c.courier_name, label: c.courier_label }));
  return { clients, couriers };
}

/** Searchable dropdown (input + datalist) showing names; controlled by value, so it shows a filter set elsewhere (View AWBs) and clears with it. */
export function NamePick({ value, options, placeholder, onPick, width = 150 }: { value?: string; options: Opt[]; placeholder: string; onPick: (v?: string) => void; width?: number }) {
  const id = useId();
  const label = options.find((o) => o.v === value)?.label ?? value ?? "";
  const [text, setText] = useState(label);
  useEffect(() => setText(label), [label]);
  const match = (t: string) => options.find((o) => o.label.toLowerCase() === t.trim().toLowerCase());
  return (<>
    <input className="input" style={{ width }} list={id} placeholder={placeholder} value={text}
      onChange={(e) => { setText(e.target.value); const o = match(e.target.value); if (o && o.v !== value) onPick(o.v); else if (!e.target.value && value) onPick(undefined); }}
      onBlur={() => setText(label)} />
    <datalist id={id}>{options.map((o) => <option key={o.v} value={o.label} />)}</datalist>
  </>);
}
export type GroupCol = { k: string; label: string; num?: boolean; render?: (r: Row) => ReactNode; total?: (rows: Row[]) => ReactNode };

/** Group rows for the current filters, with lost/damage split from two extra group calls (same endpoint, case_type filter). */
function useGroups(q: DisputeListQuery, on: boolean) {
  return useApi(async () => {
    if (!on) return [] as Row[];
    const base = { ...q, page: 1 };
    const [all, lost, dmg] = await Promise.all([api.listDisputes(base), q.case_type ? null : api.listDisputes({ ...base, case_type: "LOST" }), q.case_type ? null : api.listDisputes({ ...base, case_type: "DAMAGED" })]);
    const key = (r: Row) => String(q.view === "courier" ? r.courier_name : r.tenant_id);
    const m = (p: { items: Row[] } | null) => Object.fromEntries((p?.items ?? []).map((r) => [key(r), r.cases ?? 0]));
    const L = m(lost), D = m(dmg);
    return (all.items ?? []).map((r) => ({ ...r, lost: q.case_type === "LOST" ? r.cases : q.case_type === "DAMAGED" ? 0 : L[key(r)] ?? 0, damaged: q.case_type === "DAMAGED" ? r.cases : q.case_type === "LOST" ? 0 : D[key(r)] ?? 0 })) as Row[];
  }, [JSON.stringify(q), on]);
}

export function CaseListView({ q, setQ, variant, groupCols, typeTabs = true, extraFilters, note, actions }: {
  q: DisputeListQuery; setQ: (q: DisputeListQuery) => void; variant: "ops" | "accounts" | "kam" | "mgmt"; groupCols: (view: View) => GroupCol[];
  typeTabs?: boolean; extraFilters?: ReactNode; note?: ReactNode; actions: ("update" | "release")[];
}) {
  const view = (q.view ?? "awb") as View;
  const [ids, setIds] = useState<string[]>([]);
  const [drawer, setDrawer] = useState<null | { k: "update" | "release" | "approval"; rows: Row[] }>(null);
  const isAwb = view === "awb";
  const list = useApi(() => (isAwb ? api.listDisputes(q) : Promise.resolve(null)), [JSON.stringify(q), isAwb]);
  const groups = useGroups(q, !isAwb);
  const opts = useFilterOptions();
  const counts = useApi(async () => {
    if (!typeTabs) return null;
    const b = { ...q, view: "awb" as const, page: 1, case_type: undefined };
    const [a, l, d] = await Promise.all([api.listDisputes(b), api.listDisputes({ ...b, case_type: "LOST" }), api.listDisputes({ ...b, case_type: "DAMAGED" })]);
    return { all: a.total, lost: l.total, dmg: d.total };
  }, [JSON.stringify({ ...q, case_type: undefined, page: undefined, view: undefined }), typeTabs]);
  const set = (p: Partial<DisputeListQuery>) => { setIds([]); setQ({ ...q, page: 1, ...p }); };
  const rows = list.data?.items ?? [];
  const sel = rows.filter((r) => ids.includes(rowId(r)));
  const cols = groupCols(view);
  const g: Row[] = groups.data ?? [];
  const reload = () => { setIds([]); list.reload(); groups.reload(); counts.reload(); };
  return (
    <div className="panel">
      {typeTabs && <SubTabsF value={q.case_type} set={(v) => set({ case_type: v })} items={[{ v: undefined, label: "All", n: counts.data?.all }, { v: "LOST" as const, label: "Lost", n: counts.data?.lost }, { v: "DAMAGED" as const, label: "Damage", n: counts.data?.dmg }]} />}
      <div className="fbar" style={typeTabs ? undefined : { paddingTop: 16 }}>
        <F label="View by"><Seg value={view} set={(v) => set({ view: v })} items={(variant === "accounts" || variant === "kam" ? ["client", "courier", "awb"] : ["courier", "client", "awb"]).map((v) => ({ v: v as View, label: v === "awb" ? "AWB" : v[0].toUpperCase() + v.slice(1) }))} /></F>
        <F label="Search" grow><input className="input" placeholder={variant === "accounts" ? "AWB, courier CN or client CN no." : variant === "kam" ? "AWB, order no. or client CN" : "AWB or order no."} defaultValue={q.q} onKeyDown={(e) => e.key === "Enter" && set({ q: (e.target as HTMLInputElement).value || undefined })} /></F>
        <F label="Courier"><NamePick width={130} placeholder="All couriers" options={opts.couriers} value={q.courier_name} onPick={(v) => set({ courier_name: v, courier_code: undefined })} /></F>
        <F label="Client"><NamePick width={130} placeholder="All clients" options={opts.clients} value={q.tenant_id} onPick={(v) => set({ tenant_id: v })} /></F>
        {variant !== "accounts" && <F label="Marked date"><select className="select" value={q.marked_from ? "x" : ""} onChange={(e) => { const d = Number(e.target.value); set({ marked_from: d ? new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10) : undefined }); }}><option value="">All dates</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>{q.marked_from && <option value="x" hidden>Since {q.marked_from}</option>}</select></F>}
        {variant === "ops" && <F label="Ticket status"><select className="select" value={q.status ?? ""} onChange={(e) => set({ status: e.target.value || undefined })}><option value="">All</option>{[["MARKED", "Open"], ["CLAIM_RAISED", "Claim raised"], ["FOLLOW_UP", "Follow-up"], ["COURIER_REJECTED", "CN rejected"], ["COURIER_CN_RECEIVED", "CN received"], ["PENDING_APPROVAL", "With management"], ["ESCALATED", "Escalated"], ["APPROVED_FOR_RELEASE", "Approved for release"], ["CLIENT_CN_RELEASED", "Released"], ["CLOSED", "Closed"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></F>}
        {variant !== "kam" && <F label="Source"><select className="select" value={q.source ?? ""} onChange={(e) => set({ source: (e.target.value || undefined) as DisputeListQuery["source"] })}><option value="">All</option><option value="MANUAL">Manual</option><option value="API">API</option></select></F>}
        {extraFilters}
        {(q.courier_code || q.courier_name || q.tenant_id) && <button className="btn btn-sm" onClick={() => set({ courier_code: undefined, courier_name: undefined, tenant_id: undefined })}>Clear</button>}
      </div>
      {isAwb && ids.length > 0 && (
        <div className="bulkbar"><b>{ids.length} selected</b>
          {actions.includes("update") && <button className="btn btn-sm btn-primary" onClick={() => setDrawer({ k: "update", rows: sel })}>Update status</button>}
          {actions.includes("release") && <button className="btn btn-sm btn-primary" onClick={() => setDrawer({ k: "release", rows: sel })}>Release client CN</button>}
          {actions.includes("release") && sel.length === 1 && <button className="btn btn-sm" onClick={() => setDrawer({ k: "approval", rows: sel })}>Ask management approval</button>}
        </div>
      )}
      <Status loading={isAwb ? list.loading : groups.loading} error={isAwb ? list.error : groups.error} />
      {isAwb ? (
        <>
          <CaseTable rows={rows} variant={variant} ids={ids} setIds={actions.length ? setIds : undefined}
            onUpdate={actions.includes("update") ? (r) => setDrawer({ k: "update", rows: [r] }) : undefined}
            onRelease={actions.includes("release") ? (r) => setDrawer({ k: "release", rows: [r] }) : undefined} />
          {list.data && <Pager page={list.data.page ?? 1} total={list.data.total ?? 0} pageSize={list.data.page_size ?? 50} set={(p) => setQ({ ...q, page: p })} noun="cases" />}
        </>
      ) : (
        <>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr>{cols.map((c) => <th key={c.k} className={c.num ? "num" : undefined}>{c.label}</th>)}<th>Action</th></tr></thead>
            <tbody>
              {g.map((r) => (
                <tr key={String(view === "courier" ? r.courier_name : r.tenant_id)}>
                  {cols.map((c) => <td key={c.k} className={c.num ? "num" : undefined}>{c.render ? c.render(r) : c.num ? nf(r[c.k]) : String(r[c.k] ?? "—")}</td>)}
                  <td><button className="btn btn-sm btn-outline-red" onClick={() => set({ view: "awb", ...(view === "courier" ? { courier_name: r.courier_name, courier_code: undefined } : { tenant_id: r.tenant_id }) })}>View AWBs</button></td>
                </tr>
              ))}
              {g.length > 0 && <tr className="total">{cols.map((c, i) => <td key={c.k} className={c.num ? "num" : undefined}>{i === 0 ? "Total" : c.total ? c.total(g) : ""}</td>)}<td /></tr>}
            </tbody>
          </table></div>
          {!groups.loading && !g.length && <div style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>No cases match these filters</div>}
          <div className="pager"><span>Grouped by {view} · {nf(sum(g, "cases"))} {q.tab === "closed" ? "closed" : "open"} cases</span></div>
        </>
      )}
      {note && <p className="note-sm" style={{ marginTop: 10 }}>{note}</p>}
      {drawer?.k === "update" && <UpdateStatusDrawer cases={drawer.rows} onClose={() => setDrawer(null)} onDone={reload} />}
      {drawer?.k === "release" && <ReleaseDrawer cases={drawer.rows} onClose={() => setDrawer(null)} onDone={reload} />}
      {drawer?.k === "approval" && <ApprovalDrawer c={drawer.rows[0]} onClose={() => setDrawer(null)} onDone={reload} />}
    </div>
  );
}
export { rs };
