"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { RoleGate, Status, rowId, useApi, useRole } from "@/components/ApiKit";
import { Head, PTabs, awbOf, clientOf, courierOf, dayFull, liab, rs } from "@/components/FigmaKit";
import { api, type Row } from "@/lib/api";

type Tab = "approvals" | "escalations" | "decided";
const KIND: Record<string, string> = { EXCEPTION: "Release without courier CN", ABOVE_LIABILITY: "Above client liability", ESCALATION: "Escalation" };
const waitD = (r: Row) => Math.floor((Date.now() - new Date(r.approval?.requested?.at ?? Date.now()).getTime()) / 86_400_000);

export default function ApprovalsPage() {
  const role = useRole();
  const [tab, setTab] = useState<Tab>("approvals");
  const [pick, setPick] = useState<Row | null>(null);
  const [decision, setDecision] = useState<"APPROVE" | "REJECT" | "SEND_BACK">("APPROVE");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const res = useApi(() => api.approvals({ tab }), [tab]);
  const counts = useApi(async () => { const [a, e] = await Promise.all([api.approvals({ tab: "approvals" }), api.approvals({ tab: "escalations" })]); return { a: a.total, e: e.total, v: (a.items ?? []).reduce((s, r) => s + (r.approval?.requested_amount ?? 0), 0), old: Math.max(0, ...[...a.items, ...e.items].map(waitD)) }; }, []);
  const items = res.data?.items ?? [];
  useEffect(() => { setPick(items[0] ?? null); setNote(""); setErr(null); }, [res.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = pick?.approval ?? {};
  const amount = a.requested_amount ?? pick?.client_liability;
  const decide = async () => {
    if (!pick) return;
    setBusy(true); setErr(null);
    try { await api.decide(rowId(pick), String(a.id), { decision, note: note || undefined }); res.reload(); counts.reload(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <RoleGate roles={["MANAGEMENT", "ACCOUNTS"]}>
      <div className="page">
        <Head back={{ href: "/management", label: "Back to dashboard" }} crumbs="Lost & Damage / Approvals" title="Decisions waiting on you" />
        <PTabs value={tab} set={setTab} hint={counts.data ? `${rs(counts.data.v)} waiting · oldest ${counts.data.old} days` : undefined}
          items={[{ v: "approvals", label: "Release approvals", n: counts.data?.a }, { v: "escalations", label: "Escalations", n: counts.data?.e }, { v: "decided", label: "Decided" }]} />
        <Status loading={res.loading} error={res.error} />
        {!res.loading && !items.length && <div className="card card-pad note-sm">Nothing waiting here.</div>}
        {items.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 18, alignItems: "start" }}>
            <div>{items.map((r) => (
              <div key={`${rowId(r)}-${r.approval?.id}`} className={`ap-item${pick === r ? " on" : ""}`} onClick={() => { setPick(r); setNote(""); setErr(null); }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span className="mono strong">{awbOf(r)}</span><b>{liab(r.approval?.requested_amount ?? r.client_liability)}</b></div>
                <div className="note-sm" style={{ margin: "4px 0" }}>{clientOf(r)} · {courierOf(r)}</div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span className={`chip ${r.approval?.kind === "ABOVE_LIABILITY" ? "amber" : "purple"}`}>{KIND[r.approval?.kind] ?? r.approval?.kind}</span><span className="note-sm">{tab === "decided" ? r.approval?.status : `waiting ${waitD(r)} d`}</span></div>
              </div>))}</div>
            {pick && (
              <div className="card card-pad">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{awbOf(pick)}</span><span className="chip purple">{KIND[a.kind] ?? a.kind}</span></div>
                  <Link className="vlink" style={{ textDecoration: "underline" }} href={`/cases/${rowId(pick)}`}>Full case history</Link></div>
                <p className="note-sm">{clientOf(pick)} · {courierOf(pick)} · Order {pick.orderno ?? "—"} · {pick.case_id}</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                  {[["Item value", pick.invoice_amount, false], ["Client liability", pick.client_liability, pick.client_cof_only], ["Courier liability", pick.courier_liability, pick.courier_cof_only]].map(([k, v, cof]) => <div key={String(k)} className="card" style={{ padding: 12 }}><div className="sect-label" style={{ margin: 0 }}>{k}</div><b style={{ fontSize: 16 }}>{liab(v, rs, cof)}</b></div>)}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                  <div className="card" style={{ padding: 12 }}><div className="sect-label" style={{ margin: 0 }}>Release asked</div><b style={{ fontSize: 16 }}>{rs(amount)}</b></div>
                  <div className="card" style={{ padding: 12, background: "var(--red-soft)", borderColor: "#fecaca" }}><div className="sect-label t-red" style={{ margin: 0 }}>Exception type</div><b className="t-red">{a.exception_type ?? KIND[a.kind] ?? "—"}</b></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14, fontSize: 12.5 }}>
                  <div><div className="sect-label" style={{ margin: 0 }}>Raised by</div>{a.requested?.name ?? "—"}{a.requested?.role ? ` (${a.requested.role})` : ""} · {dayFull(a.requested?.at)}</div>
                  <div><div className="sect-label" style={{ margin: 0 }}>Needed by</div>{dayFull(a.needed_by)}</div>
                </div>
                {!!a.reasons?.length && <div style={{ marginTop: 10, fontSize: 12.5 }}><div className="sect-label" style={{ margin: 0 }}>Reasons</div>{a.reasons.join(", ")}</div>}
                <div className="quote" style={{ background: "var(--head-bg)", borderRadius: 10, padding: 12, marginTop: 12, fontSize: 13 }}><b>Justification from {a.requested?.name ?? "requester"}</b><div>{a.justification ?? "—"}</div></div>
                {tab === "decided" ? <p className="note-sm" style={{ marginTop: 14 }}>Decided: {a.status} by {a.decided?.name ?? "—"} · {dayFull(a.decided?.at)} {a.decision_note ? `· “${a.decision_note}”` : ""}</p> : role === "MANAGEMENT" ? (
                  <div style={{ borderTop: "1px solid var(--line)", marginTop: 16, paddingTop: 14 }}>
                    <div><b>Your decision</b></div>
                    <div className="seg" style={{ margin: "10px 0" }}>{(["APPROVE", "REJECT", "SEND_BACK"] as const).map((x) => <button key={x} className={decision === x ? "on" : ""} onClick={() => setDecision(x)}>{x === "APPROVE" ? "Approve" : x === "REJECT" ? "Reject" : "Send back"}</button>)}</div>
                    <label className="note-sm" style={{ display: "block", marginBottom: 6 }}>Note {decision === "APPROVE" ? "(optional)" : "(required)"}</label>
                    <textarea className="textarea" style={{ width: "100%", minHeight: 70 }} value={note} onChange={(e) => setNote(e.target.value)} />
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                      <span className="note-sm" style={{ flex: 1 }}>{err ? <span className="errline">{err}</span> : decision === "APPROVE" ? `Approves ${rs(amount)} only. Accounts can then release.` : "The requester sees your note."}</span>
                      <button className="btn btn-dark" disabled={busy || (decision !== "APPROVE" && !note)} onClick={decide}>{busy ? "Saving…" : decision === "APPROVE" ? `Approve ${rs(amount)}` : decision === "REJECT" ? "Reject" : "Send back"}</button>
                    </div>
                  </div>) : <p className="note-sm" style={{ marginTop: 14 }}>Only management can decide.</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </RoleGate>
  );
}
