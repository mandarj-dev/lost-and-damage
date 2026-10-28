"use client";
import Link from "next/link";
import { useState } from "react";
import { RoleGate, useApi } from "@/components/ApiKit";
import { CaseListView, type GroupCol } from "@/components/CaseListView";
import { F, Head, Ico, KpiCard, PTabs, courierOf, liab, nf, rs, sum } from "@/components/FigmaKit";
import { api, type DisputeListQuery } from "@/lib/api";

type Tab = "ready" | "await" | "mgmt" | "released";
const TABQ: Record<Tab, Partial<DisputeListQuery>> = {
  ready: { tab: "open", pending_at: "ACCOUNTS" }, await: { tab: "open", pending_at: "COURIER" },
  mgmt: { tab: "open", pending_at: "MANAGEMENT" }, released: { tab: "open", status: "CLIENT_CN_RELEASED" },
};
const NOTE: Record<Tab, string> = {
  ready: "Courier CN is recorded on these cases. Release defaults to client liability; SD absorbs the gap.",
  await: "Release to client is locked until the courier CN is recorded, unless management approves an exception.",
  mgmt: "These cases are waiting for a management decision.",
  released: "Released cases stay here until the courier CN is settled; then they close.",
};
const cols = (view: string): GroupCol[] => [
  view === "client" ? { k: "client_name", label: "Client", render: (r) => <b>{r.client_name ?? r.tenant_id ?? "—"}</b> } : { k: "courier_name", label: "Courier", render: (r) => <b>{courierOf(r) ?? "—"}</b> },
  { k: "cases", label: "Cases", num: true, total: (g) => nf(sum(g, "cases")) },
  { k: "client_liability", label: "Client liability", num: true, render: (r) => <b>{liab(r.client_liability, rs, r.client_cof_only)}</b>, total: (g) => rs(sum(g, "client_liability")) },
  { k: "cnin", label: "Courier CN in", num: true, render: () => <span className="na-note">—</span> },
  { k: "gap", label: "SD gap", num: true, render: () => <span className="na-note">—</span> },
];

export default function AccountsPage() {
  const [tab, setTab] = useState<Tab>("ready");
  const [q, setQ] = useState<DisputeListQuery>({ view: "client", page: 1, ...TABQ.ready });
  const k = useApi(async () => {
    const g = (p: Partial<DisputeListQuery>) => api.listDisputes({ view: "client", ...p });
    const [r, a, m, rel] = await Promise.all([g(TABQ.ready), g(TABQ.await), g(TABQ.mgmt), g(TABQ.released)]);
    return { r, a, m, rel };
  }, []);
  const d = k.data;
  const cases = (p?: { items: Record<string, number>[] }) => sum(p?.items, "cases");
  return (
    <RoleGate roles={["ACCOUNTS"]}>
      <div className="page">
        <Head crumbs="Lost & Damage / Client CN release" title="Client CN release" actions={<>
          <button className="btn" disabled title="CSV export is not available from the backend yet">{Ico.down} Export view</button>
          <Link href="/accounts/settlements" className="btn">Courier settlements</Link></>} />
        {k.error && <p className="errline">{k.error}</p>}
        <div className="kpis c4">
          <KpiCard label="Courier CN receivable" icon={Ico.truck} ico="blue" value={undefined} />
          <KpiCard label="Client CN issuable" icon={Ico.card} ico="red" hot value={d ? rs(sum(d.r.items, "client_liability") + sum(d.a.items, "client_liability") + sum(d.m.items, "client_liability")) : ""} sub={d && `${cases(d.r) + cases(d.a) + cases(d.m)} orders · client liability not yet released`} />
          <KpiCard label="Ready to release" icon={Ico.check} ico="green" tone="green" value={d ? rs(sum(d.r.items, "client_liability")) : ""} sub={d && `${cases(d.r)} cases · courier CN in`} />
          <KpiCard label="With management" icon={Ico.person} ico="purple" value={d ? rs(sum(d.m.items, "client_liability")) : ""} sub={d && `${cases(d.m)} cases`} />
        </div>
        <PTabs value={tab} set={(t) => { setTab(t); setQ({ view: q.view, page: 1, ...TABQ[t] }); }}
          items={[{ v: "ready", label: "Ready to release", n: d ? cases(d.r) : undefined }, { v: "await", label: "Awaiting courier CN", n: d ? cases(d.a) : undefined }, { v: "mgmt", label: "With management", n: d ? cases(d.m) : undefined }, { v: "released", label: "Released / closed", n: d ? cases(d.rel) : undefined }]} />
        <CaseListView q={q} setQ={setQ} variant="accounts" typeTabs={false} groupCols={cols} actions={tab === "ready" || tab === "await" ? ["update", "release"] : []} note={NOTE[tab]}
          extraFilters={<F label="Client dues"><select className="select" disabled title="Client dues are not available from the backend yet"><option>All</option></select></F>} />
      </div>
    </RoleGate>
  );
}
