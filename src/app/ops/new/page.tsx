"use client";
// Mark shipment lost or damaged (Figma KAM drawer, also used by OPS "Mark case"): GET /shipments/lookup → POST /uploads → POST /disputes.
import Link from "next/link";
import { useState } from "react";
import { RoleGate, useApi, useRole } from "@/components/ApiKit";
import { DropUpload, Head, awbOf, clientOf, courierOf, dayFull, rs } from "@/components/FigmaKit";
import { api, type EvidenceFile, type Row } from "@/lib/api";

export default function MarkCasePage() {
  const role = useRole();
  const [term, setTerm] = useState("");
  const [cards, setCards] = useState<Row[] | null>(null);
  const [pick, setPick] = useState<Row | null>(null);
  const [type, setType] = useState<"LOST" | "DAMAGED">("LOST");
  const [f, setF] = useState({ reason: "", reported: new Date().toISOString().slice(0, 10), ticket: "", remarks: "" });
  const [ev, setEv] = useState<EvidenceFile[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Row | null>(null);
  const without = useApi(() => (role === "OPS" ? api.listDisputes({ without_case: true }) : Promise.resolve(null)), [role]);
  const find = async () => {
    setErr(null); setCards(null); setPick(null);
    const t = term.trim(); if (!t) return;
    try { let d: Row[]; try { d = await api.lookup({ awb: t }); } catch { d = await api.lookup({ order_no: t }); } setCards(d); setPick(d[0] ?? null); } catch (e) { setErr((e as Error).message); }
  };
  const submit = async () => {
    if (!pick) return; setBusy(true); setErr(null);
    try { const r = await api.markCase({ orderno: pick.orderno, airwaybilno: pick.airwaybilno, case_type: type, mark_reason: f.reason, client_reported_on: new Date(f.reported).toISOString(), client_ticket_ref: f.ticket || undefined, ops_remarks: f.remarks || undefined, evidence: ev }); setDone(r.data ?? {}); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const back = role === "KAM" ? "/kam" : "/ops";
  const Info = ({ l, v }: { l: string; v: React.ReactNode }) => <div><div className="sect-label" style={{ margin: 0, fontSize: 10 }}>{l}</div><div style={{ fontSize: 13.5 }}>{v ?? "—"}</div></div>;
  return (
    <RoleGate roles={["OPS", "KAM"]}>
      <div className="page">
        <Head back={{ href: back, label: "Back to cases" }} crumbs="Lost & Damage / Mark shipment" title={<>Mark shipment <span style={{ color: "var(--muted)", fontWeight: 500 }}>lost or damaged</span></>} />
        <div style={{ display: "grid", gridTemplateColumns: role === "OPS" ? "640px 1fr" : "640px", gap: 20, alignItems: "start" }}>
          <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p className="note-sm" style={{ margin: 0 }}>{role === "KAM" ? "Raised by you (KAM) · OPS takes the claim to the courier" : "OPS marks the case and takes the claim to the courier"}</p>
            {done ? <div className="banner green"><div><b>Case {done.case_id} marked.</b> <Link className="link" href={`/cases/${done.dispute_id}`}>Open case</Link></div></div> : <>
              <label style={{ fontSize: 12.5, fontWeight: 500 }}>AWB or order no. *</label>
              <div style={{ display: "flex", gap: 10 }}><input className="input mono" style={{ flex: 1 }} value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && find()} /><button className="btn" onClick={find}>Find shipment</button></div>
              {cards && cards.length > 1 && <select className="select" value={cards.indexOf(pick!)} onChange={(e) => setPick(cards[Number(e.target.value)])}>{cards.map((c, i) => <option key={i} value={i}>{c.airwaybilno} · {c.orderno}</option>)}</select>}
              {pick && <div className="card card-pad" style={{ background: "var(--head-bg)", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                <Info l="Order" v={pick.orderno} /><Info l="Client" v={clientOf(pick)} /><Info l="Courier" v={courierOf(pick)} />
                <Info l="Picked up" v={dayFull(pick.picked_up_date)} /><Info l="Last scan" v={typeof pick.last_scan === "object" && pick.last_scan ? [pick.last_scan.location ?? pick.last_scan.status, dayFull(pick.last_scan.date ?? pick.last_scan.time)].filter(Boolean).join(" · ") : pick.last_scan} /><Info l="Invoice value" v={rs(pick.invoice_amount)} />
                {pick.open_case_id && <div style={{ gridColumn: "span 3" }} className="errline">This order already has an open case ({pick.open_case_id}).</div>}
              </div>}
              {pick && <>
                <label style={{ fontSize: 12.5, fontWeight: 500 }}>Type *</label>
                <div className="seg" style={{ alignSelf: "flex-start" }}><button className={type === "LOST" ? "on" : ""} onClick={() => setType("LOST")}>Lost</button><button className={type === "DAMAGED" ? "on" : ""} onClick={() => setType("DAMAGED")}>Damaged</button></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 500 }}>Reason *<input className="input" placeholder="e.g. No scan for 4+ days, hub cannot trace" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 500 }}>Client reported on *<input className="input" type="date" value={f.reported} onChange={(e) => setF({ ...f, reported: e.target.value })} /></label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 500 }}>Client ticket / reference<input className="input" placeholder="e.g. UK-CS-44120" value={f.ticket} onChange={(e) => setF({ ...f, ticket: e.target.value })} /></label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 500 }}>Client liability<div className="input" style={{ background: "var(--red-soft)", color: "var(--muted)", border: 0 }}>Calculated from the L&amp;D agreement when the case is saved</div></div>
                </div>
                <DropUpload value={ev} onChange={setEv} label="Evidence" hint="Client complaint, tracking screenshot, hub confirmation" />
                <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 500 }}>Remarks for OPS<textarea className="textarea" placeholder="What the client told you, and anything OPS should know" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></label>
                <div className="banner" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}><div>The case opens as <b>Manual · marked by you</b>. OPS raises the claim with {pick.courier_name || pick.courier_code ? courierOf(pick) : "the courier"}.</div></div>
              </>}
              {err && <p className="errline">{err}</p>}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}><Link className="btn" href={back}>Cancel</Link><button className="btn btn-dark" disabled={!pick || !f.reason || !ev.length || busy || !!pick?.open_case_id} onClick={submit}>{busy ? "Saving…" : `Mark as ${type === "LOST" ? "lost" : "damaged"}`}</button></div>
            </>}
          </div>
          {role === "OPS" && <div className="card card-pad"><h2>Lost / damaged shipments without a case</h2>
            {without.error && <p className="errline">{without.error}</p>}
            <table className="tbl"><thead><tr><th>AWB · Order</th><th>Client · Courier</th><th /></tr></thead>
              <tbody>{(without.data?.items ?? []).map((r) => <tr key={String(r.order_id)}><td><div className="mono strong">{awbOf(r)}</div><div className="sub">{r.orderno}</div></td><td>{clientOf(r)}<div className="sub">{courierOf(r)}</div></td><td><button className="btn btn-sm btn-outline-red" onClick={() => { setTerm(r.airwaybilno); setCards([r]); setPick(r); setDone(null); }}>Mark</button></td></tr>)}</tbody></table>
            {!without.loading && !(without.data?.items ?? []).length && <p className="note-sm">None found.</p>}</div>}
        </div>
      </div>
    </RoleGate>
  );
}
