"use client";
import Link from "next/link";
import { useState } from "react";
import { RoleGate, Status, rowId, useApi } from "@/components/ApiKit";
import { SettlementDrawer } from "@/components/FigmaDrawers";
import { NamePick, useFilterOptions } from "@/components/CaseListView";
import { F, Head, Ico, KpiCard, Pager, PTabs, ageDays, courierOf, dayFull, nf, rs } from "@/components/FigmaKit";
import { api, type Row } from "@/lib/api";

type Tab = "UNSETTLED" | "PARTIAL" | "SETTLED";
const STATE: Record<string, [string, string]> = { UNSETTLED: ["Pending", "amber"], PARTIAL: ["Partly settled", "amber"], SETTLED: ["Settled", "green"] };

export default function SettlementsPage() {
  const [tab, setTab] = useState<Tab>("UNSETTLED");
  const [q, setQ] = useState<{ q?: string; courier_code?: string; courier_name?: string; expected_mode?: string; page: number }>({ page: 1 });
  const opts = useFilterOptions();
  const [ids, setIds] = useState<string[]>([]);
  const [open, setOpen] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const res = useApi(() => api.courierCns({ ...q, settlement_state: tab }), [JSON.stringify(q), tab]);
  const counts = useApi(async () => { const [u, p, s] = await Promise.all((["UNSETTLED", "PARTIAL", "SETTLED"] as Tab[]).map((t) => api.courierCns({ settlement_state: t }))); return { u, p, s }; }, []);
  const rows = res.data?.items ?? [];
  const bal = (c: Row) => (c.total_amount ?? 0) - (c.settled_amount ?? 0);
  const c = counts.data;
  // Balance KPI only when every open CN fits on the first page (the API pages by 50); otherwise it would undercount.
  const openRows = c ? [...c.u.items, ...c.p.items] : [];
  const complete = c && c.u.total <= c.u.items.length && c.p.total <= c.p.items.length;
  const sel = rows.filter((r) => ids.includes(rowId(r)));
  return (
    <RoleGate roles={["ACCOUNTS"]}>
      <div className="page">
        <Head crumbs="Lost & Damage / Courier settlements" title="Courier settlements" actions={<>
          <button className="btn" disabled title="Export is not available from the backend yet">{Ico.down} Export</button>
          <button className="btn btn-primary" disabled={!sel.length} title={sel.length ? "" : "Select CNs of one courier first"} onClick={() => setOpen(sel)}>{Ico.plus} Record settlement</button></>} />
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}><Link href="/accounts" className="btn btn-sm">‹ Client CN release</Link></div>
        <div className="kpis c4">
          <KpiCard label="CN confirmed, not settled" hot value={complete ? rs(openRows.reduce((s, r) => s + bal(r), 0)) : undefined} sub={c && `${c.u.total + c.p.total} CNs · ${c.p.total} partly settled`} />
          <KpiCard label="Unsettled > 30 days" tone="orange" value={complete ? rs(openRows.filter((r) => (ageDays(r.cn_date) ?? 0) > 30).reduce((s, r) => s + bal(r), 0)) : undefined} sub={c && `${openRows.filter((r) => (ageDays(r.cn_date) ?? 0) > 30).length} CN(s)`} />
          <KpiCard label="Settled · last 30 days" tone="green" value={undefined} />
          <KpiCard label="Settled by mode · 30 days" value={undefined} />
        </div>
        <PTabs value={tab} set={(t) => { setTab(t); setIds([]); setQ({ ...q, page: 1 }); }} items={[{ v: "UNSETTLED", label: "Unsettled", n: c?.u.total }, { v: "PARTIAL", label: "Partly settled", n: c?.p.total }, { v: "SETTLED", label: "Settled", n: c?.s.total }]} />
        <div className="panel">
          <div className="fbar" style={{ paddingTop: 16 }}>
            <F label="Search" grow><input className="input" placeholder="Courier CN, UTR or freight bill no." onKeyDown={(e) => e.key === "Enter" && setQ({ ...q, q: (e.target as HTMLInputElement).value || undefined, page: 1 })} /></F>
            <F label="Courier"><NamePick width={140} placeholder="All couriers" options={opts.couriers} value={q.courier_name} onPick={(v) => setQ({ ...q, courier_name: v, courier_code: undefined, page: 1 })} /></F>
          {(q.courier_name || q.courier_code) && <button className="btn btn-sm" onClick={() => setQ({ ...q, courier_name: undefined, courier_code: undefined, page: 1 })}>Clear</button>}
            <F label="Mode"><select className="select" value={q.expected_mode ?? ""} onChange={(e) => setQ({ ...q, expected_mode: e.target.value || undefined, page: 1 })}><option value="">All</option><option value="UTR">Bank transfer</option><option value="FREIGHT_BILL">Freight bill</option></select></F>
            <F label="CN date"><select className="select" disabled title="No CN date filter in the backend yet"><option>Last 90 days</option></select></F>
          </div>
          {msg && <p className="note-sm">{msg}</p>}
          <Status loading={res.loading} error={res.error} />
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th className="cb" /><th>Courier CN</th><th>Courier · CN date</th><th className="num">AWBs</th><th className="num">CN amount</th><th className="num">Settled</th><th className="num">Balance</th><th>Settlement</th><th>Action</th></tr></thead>
            <tbody>{rows.map((r) => { const last = (r.settlements ?? []).slice(-1)[0]; const [l, t] = STATE[r.settlement_state] ?? [r.settlement_state, "grey"]; const age = ageDays(r.cn_date); return (
              <tr key={rowId(r)}>
                <td className="cb">{r.settlement_state !== "SETTLED" && <input type="checkbox" checked={ids.includes(rowId(r))} onChange={(e) => setIds(e.target.checked ? [...ids, rowId(r)] : ids.filter((x) => x !== rowId(r)))} />}</td>
                <td><div className="mono strong">{r.cn_number}</div><div className="sub">{r.recorded?.name ? `entered by ${r.recorded.name}${r.recorded.role ? ` (${r.recorded.role})` : ""}` : ""}</div></td>
                <td><div>{courierOf(r)}</div><div className={`sub${(age ?? 0) > 30 ? " red" : ""}`}>{dayFull(r.cn_date)} · {age ?? "—"} d</div></td>
                <td className="num">{nf((r.lines ?? []).length)}</td><td className="num">{rs(r.total_amount)}</td><td className="num t-green">{rs(r.settled_amount ?? 0)}</td><td className="num t-red strong">{rs(bal(r))}</td>
                <td><span className={`chip ${t}`}>{l}</span>
                  <div className="sub">{last ? `${last.mode === "UTR" ? "Bank transfer" : "Freight bill"} · ${dayFull(last.settled_on)}` : r.expected_mode ? `Expected: ${r.expected_mode === "UTR" ? "bank transfer" : `${r.expected_freight_month ?? ""} freight bill`}` : ""}</div>
                  {last?.utr && <div className="sub mono">UTR {last.utr}</div>}{!!r.chased_count && <div className="sub mono">Chased {r.chased_count} times</div>}</td>
                <td><div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="vlink" style={{ opacity: .5 }} title="No document link from the backend yet">View CN {Ico.eye}</span>
                  {r.settlement_state !== "SETTLED" && <button className="btn btn-sm btn-primary" onClick={() => setOpen([r])}>Record</button>}
                  {r.settlement_state !== "SETTLED" && <button className="btn btn-sm" onClick={() => api.chase(rowId(r)).then((d) => { setMsg(`Chase recorded on ${r.cn_number} (${d.data?.chased_count ?? "?"} times)`); res.reload(); }).catch((e) => setMsg(e.message))}>Chase</button>}
                </div></td>
              </tr>); })}</tbody>
          </table></div>
          {!res.loading && !rows.length && <div style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>No courier CNs here</div>}
          {res.data && <Pager page={res.data.page} total={res.data.total} pageSize={res.data.page_size} set={(p) => setQ({ ...q, page: p })} noun="CNs" />}
          <p className="note-sm">A CN confirmed by the courier is not money received. Record each bank transfer or freight bill adjustment here; part payments keep the balance open.</p>
        </div>
        {open && <SettlementDrawer cns={open} onClose={() => setOpen(null)} onDone={() => { setIds([]); res.reload(); counts.reload(); }} />}
      </div>
    </RoleGate>
  );
}
