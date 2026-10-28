"use client";
import Link from "next/link";
import { useState } from "react";
import { RoleGate, Status, useApi } from "@/components/ApiKit";
import { NamePick, useFilterOptions } from "@/components/CaseListView";
import { CaseTable, F, Head, Ico, KpiCard, Pager, Seg, clientOf, courierOf, liab, nf, rs, sum } from "@/components/FigmaKit";
import { api, type Row } from "@/lib/api";

type V = "client" | "courier" | "awb";
const PEND = [["COURIER", "c", "with courier"], ["ACCOUNTS", "a", "at Accounts"], ["MANAGEMENT", "m", "with mgmt"]] as const;

export default function KamPage() {
  const [q, setQ] = useState<{ view: V; tab: "open" | "closed"; q?: string; courier_code?: string; courier_name?: string; tenant_id?: string; marked_from?: string; page: number }>({ view: "client", tab: "open", page: 1 });
  const [stmt, setStmt] = useState<string | null>(null);
  const res = useApi(() => api.kamLiability(q), [JSON.stringify(q)]);
  // Where pending cases are, per row: the same list endpoint filtered by pending_at (KAM may call GET /disputes).
  const dist = useApi(async () => {
    if (q.view === "awb" || q.tab !== "open") return null;
    const parts = await Promise.all(PEND.map(([p]) => api.listDisputes({ view: q.view as "client" | "courier", tab: "open", pending_at: p, q: q.q, marked_from: q.marked_from, courier_code: q.courier_code, courier_name: q.courier_name, tenant_id: q.tenant_id })));
    const m: Record<string, Record<string, number>> = {};
    parts.forEach((pg, i) => pg.items.forEach((r) => { const k = String(q.view === "courier" ? r.courier_name : r.tenant_id); (m[k] ??= {})[PEND[i][1]] = r.cases ?? 0; }));
    return m;
  }, [JSON.stringify(q)]);
  const st = useApi(() => (stmt ? api.clientStatement(stmt, { tab: q.tab }) : Promise.resolve(null)), [stmt, q.tab]);
  const rows = res.data?.items ?? [];
  const ps = res.data?.pending_summary ?? [];
  const pc = (p: string) => ps.find((r) => r.pending_at === p)?.cases ?? 0;
  const totalLiab = sum(rows, "client_liability");
  const set = (p: Partial<typeof q>) => setQ({ ...q, page: 1, ...p });
  const key = (r: Row) => String(q.view === "courier" ? r.courier_name : r.tenant_id);
  const opts = useFilterOptions();
  const bar = (m?: Record<string, number>) => { const t = (m?.c ?? 0) + (m?.a ?? 0) + (m?.m ?? 0); return (
    <div><div className="dist">{t > 0 && PEND.map(([, k]) => <i key={k} className={k} style={{ width: `${((m?.[k] ?? 0) / t) * 100}%` }} />)}</div>
      <div className="sub">{PEND.filter(([, k]) => m?.[k]).map(([, k, l]) => `${m![k]} ${l}`).join(" · ") || "—"}</div></div>); };
  return (
    <RoleGate roles={["KAM", "MANAGEMENT"]}>
      <div className="page">
        {/* KAM name / "my N clients" in the crumbs and sidebar stay generic: the backend has no KAM-to-client mapping yet. */}
        <Head crumbs="Lost & Damage / Client liability" title="Client liability" actions={<>
          <button className="btn" disabled={q.view !== "client"} title="Pick View AWBs on a client row, or use the Statement link" onClick={() => rows[0] && setStmt(String(rows[0].tenant_id))}>{Ico.down} Client statement</button>
          <Link href="/ops/new" className="btn btn-primary">{Ico.plus} Mark shipment lost / damaged</Link></>} />
        <div className="kpis c4">
          <KpiCard label="Total client liability" icon={Ico.layers} value={res.data && q.view !== "awb" ? rs(totalLiab) : res.data ? rs(totalLiab) : ""} sub={res.data && `${nf(q.view === "awb" ? res.data.total : sum(rows, "cases"))} cases`} />
          <KpiCard label="Released to clients" icon={Ico.check} ico="green" tone="green" value={undefined} />
          <KpiCard label="Pending release" icon={Ico.clock} ico="red" hot value={res.data ? rs(sum(ps.filter((r) => r.pending_at), "client_liability")) : ""} sub={res.data && `${nf(sum(ps.filter((r) => r.pending_at), "cases"))} cases · ${pc("COURIER")} with courier · ${pc("ACCOUNTS")} at Accounts · ${pc("MANAGEMENT")} with management`} />
          <KpiCard label="Oldest pending" icon={Ico.cal} ico="amber" value={undefined} />
        </div>
        <div className="panel">
          <div className="fbar" style={{ paddingTop: 16 }}>
            <F label="View by"><Seg value={q.view} set={(v) => set({ view: v })} items={[{ v: "client", label: "Client" }, { v: "courier", label: "Courier" }, { v: "awb", label: "AWB" }]} /></F>
            <F label="Client"><NamePick placeholder="All my clients" options={opts.clients} value={q.tenant_id} onPick={(v) => set({ tenant_id: v })} /></F>
            <F label="Courier"><NamePick placeholder="All couriers" options={opts.couriers} value={q.courier_name} onPick={(v) => set({ courier_name: v, courier_code: undefined })} /></F>
            {(q.tenant_id || q.courier_name || q.courier_code) && <button className="btn btn-sm" onClick={() => set({ tenant_id: undefined, courier_name: undefined, courier_code: undefined })}>Clear</button>}
            <F label="Liability status"><select className="select" value={q.tab} onChange={(e) => set({ tab: e.target.value as "open" | "closed" })}><option value="open">Open</option><option value="closed">Closed</option></select></F>
          </div>
          <div className="fbar" style={{ paddingTop: 0 }}>
            <F label="Search" grow><input className="input" placeholder="AWB, order no. or client CN" onKeyDown={(e) => e.key === "Enter" && set({ q: (e.target as HTMLInputElement).value || undefined })} /></F>
            <F label="Marked date"><select className="select" onChange={(e) => { const d = Number(e.target.value); set({ marked_from: d ? new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10) : undefined }); }}><option value="0">All dates</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></F>
          </div>
          <p className="note-sm" style={{ marginTop: 0 }}>Client liability is what ShipDelight owes the client, excl. GST. Courier amounts stay with OPS and Accounts.</p>
          <Status loading={res.loading} error={res.error} />
          {q.view === "awb" ? <CaseTable rows={rows} variant="kam" ids={[]} /> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>{q.view === "client" ? "Client" : "Courier"}</th><th className="num">Cases</th><th className="num">Client liability</th><th className="num">Released</th><th className="num">Pending</th><th>Where pending cases are</th><th className="num">Oldest pending</th><th>Action</th></tr></thead>
              <tbody>
                {rows.length > 0 && <tr className="total"><td>Total</td><td className="num">{nf(sum(rows, "cases"))}</td><td className="num">{rs(totalLiab)}</td><td className="num na-note">—</td><td className="num t-red">{q.tab === "open" ? rs(sum(ps.filter((r) => r.pending_at), "client_liability")) : "—"}</td><td className="note-sm">{pc("COURIER")} with courier · {pc("ACCOUNTS")} at Accounts · {pc("MANAGEMENT")} with mgmt</td><td /><td /></tr>}
                {rows.map((r, i) => (
                  <tr key={`#${i}`}><td className="strong">{q.view === "client" ? clientOf(r) : courierOf(r)}</td><td className="num">{nf(r.cases)}</td><td className="num strong">{rs(r.client_liability)}</td>
                    <td className="num na-note">—</td><td className="num na-note">—</td><td>{q.tab === "open" ? bar(dist.data?.[key(r)]) : "—"}</td><td className="num na-note">—</td>
                    <td><div style={{ display: "flex", gap: 6 }}><button className="btn btn-sm btn-outline-red" onClick={() => set({ view: "awb", ...(q.view === "client" ? { tenant_id: r.tenant_id } : { courier_name: r.courier_name, courier_code: undefined }) })}>View AWBs</button>
                      {q.view === "client" && <button className="btn btn-sm" onClick={() => setStmt(String(r.tenant_id))}>Statement</button>}</div></td></tr>))}
              </tbody></table></div>)}
          {res.data && q.view === "awb" && <Pager page={res.data.page} total={res.data.total} pageSize={res.data.page_size} set={(p) => setQ({ ...q, page: p })} noun="cases" />}
          {q.view !== "awb" && <div className="legend"><span><i style={{ background: "#9ca3af" }} />With courier (OPS chasing)</span><span><i style={{ background: "#2563eb" }} />Ready at Accounts</span><span><i style={{ background: "#7c3aed" }} />With management</span></div>}
          <p className="note-sm">{q.view === "courier" ? "Same cases grouped by courier, so you can tell a client which courier is holding up their payout." : "Opens on the client view. Choose View AWBs to see a client's cases."}</p>
        </div>
        {stmt && (
          <div className="card card-pad" style={{ marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><h2>Client statement · {st.data?.client_name ?? stmt}</h2><button className="btn btn-sm" onClick={() => setStmt(null)}>Close</button></div>
            <Status loading={st.loading} error={st.error} />
            {st.data && <>
              <div className="kpis c4">{[["Cases", nf(st.data.totals?.cases)], ["Invoice value", rs(st.data.totals?.invoice_amount)], ["Client liability", rs(st.data.totals?.client_liability)], ["Client CN released", rs(st.data.totals?.client_cn_amount)]].map(([l, v]) => <KpiCard key={l} label={l} value={v} />)}</div>
              <table className="tbl"><thead><tr><th>AWB · Order</th><th>Case</th><th>Status</th><th className="num">Client liability</th><th>Client CN</th><th className="num">CN amount</th></tr></thead>
                <tbody>{(st.data.items as Row[] ?? []).map((r) => <tr key={String(r._id)}><td><div className="mono strong">{r.airwabilno}</div><div className="sub">{r.orderno}</div></td><td>{r.case_id}</td><td>{r.status}</td><td className="num">{liab(r.client_liability, rs, r.client_cof_only)}</td><td className="mono">{r.client_cn?.number ?? "—"}</td><td className="num">{rs(r.client_cn?.amount)}</td></tr>)}</tbody></table>
            </>}
          </div>
        )}
      </div>
    </RoleGate>
  );
}
