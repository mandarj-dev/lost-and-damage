"use client";
import Link from "next/link";
import { useState } from "react";
import { RoleGate, useApi } from "@/components/ApiKit";
import { CaseListView, type GroupCol } from "@/components/CaseListView";
import { Head, Ico, KpiCard, PTabs, courierOf, liab, nf, rs, sum } from "@/components/FigmaKit";
import { api, type DisputeListQuery } from "@/lib/api";

const cols = (view: string): GroupCol[] => [
  view === "courier" ? { k: "courier_name", label: "Courier", render: (r) => <b>{courierOf(r) ?? "—"}</b> } : { k: "client_name", label: "Client", render: (r) => <b>{r.client_name ?? r.tenant_id ?? "—"}</b> },
  { k: "cases", label: "Open cases", num: true, total: (g) => nf(sum(g, "cases")) },
  { k: "ld", label: "Lost · Damage", num: true, render: (r) => `${r.lost} · ${r.damaged}`, total: (g) => `${sum(g, "lost")} · ${sum(g, "damaged")}` },
  { k: "courier_liability", label: "Claim value pending", num: true, render: (r) => liab(r.courier_liability, rs, r.courier_cof_only), total: (g) => rs(sum(g, "courier_liability")) },
  { k: "cn30", label: "CN received 30 d", num: true, render: () => <span className="na-note">—</span> },
  { k: "oldest", label: "Oldest case", num: true, render: () => <span className="na-note">—</span> },
  { k: "window_lte_7_count", label: "Window ≤ 7 d", num: true, render: (r) => <span className={r.window_lte_7_count ? "t-red strong" : ""}>{r.window_lte_7_count ?? 0}</span>, total: (g) => nf(sum(g, "window_lte_7_count")) },
];

export default function OpsPage() {
  const [q, setQ] = useState<DisputeListQuery>({ tab: "open", view: "courier", page: 1 });
  const k = useApi(async () => {
    const [open, closed, api7, groups, w7] = await Promise.all([
      api.listDisputes({ tab: "open", view: "awb" }), api.listDisputes({ tab: "closed", view: "awb" }), api.listDisputes({ tab: "open", view: "awb", source: "API" }),
      api.listDisputes({ tab: "open", view: "courier" }), api.listDisputes({ tab: "open", view: "awb", window_lte: 7 })]);
    const [lost, dmg] = await Promise.all([api.listDisputes({ tab: "open", view: "awb", case_type: "LOST" }), api.listDisputes({ tab: "open", view: "awb", case_type: "DAMAGED" })]);
    return { open: open.total, closed: closed.total, api: api7.total, lost: lost.total, dmg: dmg.total, claim: sum(groups.items, "courier_liability"), couriers: groups.items.length, w7: w7.total };
  }, []);
  const d = k.data;
  return (
    <RoleGate roles={["OPS"]}>
      <div className="page">
        <Head crumbs="Lost & Damage / Cases" title="Lost & Damage Disputes" actions={<>
          <button className="btn" disabled title="CSV export is not available from the backend yet">{Ico.down} Export view</button>
          <Link href="/ops/bulk" className="btn">{Ico.up} Bulk update (Excel)</Link>
          <Link href="/ops/new" className="btn btn-primary">{Ico.plus} Mark case</Link></>} />
        {k.error && <p className="errline">{k.error}</p>}
        <div className="kpis c4">
          <KpiCard label="Open cases" icon={Ico.layers} value={d ? nf(d.open) : ""} sub={d && `Lost ${d.lost} · Damage ${d.dmg} · ${d.api} API-marked`} />
          <KpiCard label="Claim value pending" icon={Ico.card} ico="blue" value={d ? rs(d.claim) : ""} sub={d && `Across ${d.couriers} courier${d.couriers === 1 ? "" : "s"}`} />
          <KpiCard label="CN received · 30 days" icon={Ico.check} ico="green" tone="green" value={undefined} />
          <KpiCard label="Claim window ≤ 7 days" icon={Ico.clock} ico="red" tone="red" value={d ? nf(d.w7) : ""} sub="Raise claim before the courier window closes" />
        </div>
        <PTabs value={q.tab ?? "open"} set={(t) => setQ({ ...q, tab: t, page: 1 })} hint="Every open case can be followed up by OPS, manual or API-marked"
          items={[{ v: "open", label: "Open cases", n: d?.open }, { v: "closed", label: "Closed cases", n: d?.closed }]} />
        <CaseListView q={q} setQ={setQ} variant="ops" groupCols={cols} actions={["update"]} />
      </div>
    </RoleGate>
  );
}
