"use client";
import Link from "next/link";
import { useState } from "react";
import { RoleGate, Status, useApi } from "@/components/ApiKit";
import { NamePick, useFilterOptions } from "@/components/CaseListView";
import { Head, Ico, KpiCard, clientOf, courierOf, nf, rs, sum } from "@/components/FigmaKit";
import { api, type Row } from "@/lib/api";

const NA = () => <span className="na-note">—</span>;
const MONTH = (m: string) => new Date(`${m}-01`).toLocaleDateString("en-IN", { month: "short" });

export default function ManagementPage() {
  const [days, setDays] = useState(90);
  const [courier, setCourier] = useState<string | undefined>();
  const [client, setClient] = useState<string | undefined>();
  const opts = useFilterOptions();
  const from = days ? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10) : undefined;
  const rep = useApi(() => api.managementReport({ marked_from: from, courier_name: courier, tenant_id: client }), [days, courier, client]);
  const ap = useApi(async () => { const [a, e] = await Promise.all([api.approvals({ tab: "approvals" }), api.approvals({ tab: "escalations" })]); return { a, e }; }, []);
  const d = rep.data;
  const sc = d?.scorecard ?? [], cv = d?.client_view ?? [], gapM = d?.sd_gap_by_month ?? [], age = d?.pending_by_age ?? [];
  const courierCn = sum(sc, "courier_cn_amount"), clientCn = sum(cv, "client_cn_amount");
  const maxGap = Math.max(1, ...gapM.map((r) => r.sd_gap ?? 0)), maxAge = Math.max(1, ...age.map((r) => r.client_liability ?? 0));
  const waiting = [...(ap.data?.a.items ?? []), ...(ap.data?.e.items ?? [])];
  const nWait = (ap.data?.a.total ?? 0) + (ap.data?.e.total ?? 0);
  const oldest = Math.max(0, ...waiting.map((r) => Math.floor((Date.now() - new Date(r.approval?.requested?.at ?? Date.now()).getTime()) / 86_400_000)));
  return (
    <RoleGate roles={["MANAGEMENT"]}>
      <div className="page">
        <Head crumbs={`Lost & Damage / Dashboard · ${days ? `last ${days} days` : "all time"}`} title="Lost & Damage dashboard" actions={<>
          <select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last 12 months</option><option value={0}>All time</option></select>
          <NamePick width={130} placeholder="All couriers" options={opts.couriers} value={courier} onPick={setCourier} />
          <NamePick width={130} placeholder="All clients" options={opts.clients} value={client} onPick={setClient} />
          {(courier || client) && <button className="btn btn-sm" onClick={() => { setCourier(undefined); setClient(undefined); }}>Clear</button>}
          <button className="btn" disabled title="Export is not available from the backend yet">{Ico.down} Export</button></>} />
        <div className="decide-banner"><div className="n">{nWait}</div>
          <div style={{ flex: 1 }}><b>cases need your decision</b><div className="note-sm">{ap.data ? `${ap.data.a.total} release approvals worth ${rs(sum(ap.data.a.items.map((r) => r.approval ?? {}), "requested_amount"))} · ${ap.data.e.total} escalations · oldest waiting ${oldest} days` : ap.error ?? "Loading…"}</div></div>
          <Link href="/management/approvals" className="btn btn-primary">Review now</Link></div>
        <Status loading={rep.loading} error={rep.error} />
        <div className="sect-label">What couriers owe ShipDelight</div>
        <div className="kpis c3">
          <KpiCard label="Courier CN issued" value={d ? rs(courierCn) : ""} sub="CN confirmed by courier" />
          <KpiCard label="Courier CN amount released" tone="green" value={undefined} />
          <KpiCard label="Courier CN receivable" value={undefined} />
        </div>
        <div className="sect-label">What ShipDelight owes clients</div>
        <div className="kpis c4">
          <KpiCard label="Client CN issued" value={d ? rs(clientCn) : ""} sub={d && `${nf(cv.reduce((s, r) => s + (r.client_cn_amount ? 1 : 0), 0))} clients with releases`} />
          <KpiCard label="Client CN issuable" hot value={d ? rs(sum(cv, "client_liability") - clientCn) : ""} sub="client liability not yet released" />
          <KpiCard label="Courier recovery rate" value={d ? (clientCn ? `${((courierCn / clientCn) * 100).toFixed(1)}%` : "—") : ""} sub={d && `${rs(courierCn)} courier CN on ${rs(clientCn)} released`} />
          <KpiCard label="SD gap absorbed" tone="orange" value={d ? rs(sum(gapM, "sd_gap")) : ""} sub={d && `${nf(sum(gapM, "cases"))} released cases`} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          <div className="card card-pad"><div style={{ display: "flex", justifyContent: "space-between" }}><h2>Claim value pending by age</h2><span className="note-sm">Days since marked</span></div>
            {age.map((r) => <div key={r.age_bucket} className="hbar"><b>{r.age_bucket} d</b><div className="tr"><i style={{ width: `${((r.client_liability ?? 0) / maxAge) * 100}%`, background: r.age_bucket === "30+" ? "#dc2626" : r.age_bucket === "16-30" ? "#f59e0b" : "#9ca3af" }} /></div><span className="note-sm" style={{ textAlign: "right" }}>{rs(r.client_liability)} · {r.cases} cases</span></div>)}
            <p className="note-sm">Cases past 30 days are the most likely to need a write-off decision.</p></div>
          <div className="card card-pad"><div style={{ display: "flex", justifyContent: "space-between" }}><h2>SD gap absorbed by month</h2><span className="note-sm">₹, excl. GST</span></div>
            <div className="vbars">{gapM.length ? gapM.slice(-3).map((r) => <div key={r.month} className="vb"><span>{rs(r.sd_gap)}</span><i style={{ height: `${Math.max(4, ((r.sd_gap ?? 0) / maxGap) * 100)}px` }} /><span className="note-sm">{MONTH(r.month)}</span></div>) : <span className="note-sm">No releases in this period</span>}</div>
            <p className="note-sm" style={{ textAlign: "center" }}>{(d?.decision_time ?? []).map((r: Row) => `${r.kind}: ${r.decisions} decided · avg ${r.average_hours} h`).join(" · ") || "No decisions yet"}</p></div>
        </div>
        <div className="card card-pad" style={{ marginBottom: 20 }}><div style={{ display: "flex", justifyContent: "space-between" }}><h2>Courier scorecard</h2><span className="note-sm">Recovery = courier CN ÷ courier liability claimed</span></div>
          <table className="tbl"><thead><tr><th>Courier</th><th className="num">Open cases</th><th className="num">Claim pending</th><th className="num">Recovery</th><th className="num">Avg days to CN</th><th className="num">Rejection rate</th><th className="num">SD gap absorbed</th></tr></thead>
            <tbody>{sc.map((r) => <tr key={String(r.courier_name)}><td className="strong">{courierOf(r)}</td><td className="num">{nf(r.open_cases)}</td><td className="num">{rs(r.courier_liability)}</td><td className="num">{r.courier_liability ? `${(((r.courier_cn_amount ?? 0) / r.courier_liability) * 100).toFixed(1)}%` : "—"}</td><td className="num"><NA /></td><td className="num"><NA /></td><td className="num"><NA /></td></tr>)}
              {sc.length > 0 && <tr className="total"><td>Total</td><td className="num">{nf(sum(sc, "open_cases"))}</td><td className="num">{rs(sum(sc, "courier_liability"))}</td><td className="num">{sum(sc, "courier_liability") ? `${((courierCn / sum(sc, "courier_liability")) * 100).toFixed(1)}%` : "—"}</td><td /><td /><td /></tr>}</tbody></table></div>
        <div className="card card-pad"><div style={{ display: "flex", justifyContent: "space-between" }}><h2>Client view</h2><span className="note-sm">Dues = client receivables older than 30 days (not available yet)</span></div>
          <table className="tbl"><thead><tr><th>Client</th><th>KAM</th><th className="num">CN issuable</th><th className="num">Released (period)</th><th className="num">SD gap</th><th className="num">Dues</th></tr></thead>
            <tbody>{cv.map((r) => <tr key={r.tenant_id}><td className="strong">{clientOf(r)}</td><td>{r.kam_name ?? "—"}</td><td className="num t-red strong">{rs((r.client_liability ?? 0) - (r.client_cn_amount ?? 0))}</td><td className="num">{rs(r.client_cn_amount ?? 0)}</td><td className="num t-orange">{rs(r.sd_gap ?? 0)}</td><td className="num"><NA /></td></tr>)}
              {cv.length > 0 && <tr className="total"><td>Total</td><td /><td className="num">{rs(sum(cv, "client_liability") - clientCn)}</td><td className="num">{rs(clientCn)}</td><td className="num">{rs(sum(cv, "sd_gap"))}</td><td /></tr>}</tbody></table></div>
      </div>
    </RoleGate>
  );
}
