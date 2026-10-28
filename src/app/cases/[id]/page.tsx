"use client";
import Link from "next/link";
import { use, useState } from "react";
import { RoleGate, Status, useApi, useRole } from "@/components/ApiKit";
import { ApprovalDrawer, HandoffDrawer, ReleaseDrawer, UpdateStatusDrawer } from "@/components/FigmaDrawers";
import { Head, SourceChip, StatusChip, TypeTag, ageDays, awbOf, clientOf, courierOf, dayFull, liab, rs } from "@/components/FigmaKit";
import { api, type Disposition, type Row } from "@/lib/api";

type D = null | { k: "status"; d?: Disposition } | { k: "handoff" | "exception" | "release" };
const ext = (n = "") => (n.split(".").pop() ?? "").toUpperCase();
const EVT: Record<string, string> = { MARKED: "Marked", COMMENT: "Note", CLIENT_CN_RELEASED: "Client CN released", EXCEPTION_REQUESTED: "Approval requested", ABOVE_LIABILITY_REQUESTED: "Above-liability approval requested" };

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const role = useRole();
  const [drawer, setDrawer] = useState<D>(null);
  const [note, setNote] = useState("");
  const [nerr, setNerr] = useState<string | null>(null);
  const res = useApi(() => api.dispute(id), [id]);
  const c = res.data as Row | null;
  const events: Row[] = [...((c?.events as Row[]) ?? [])].reverse();
  const files: Row[] = [...((c?.evidence as Row[]) ?? []), ...(c?.client_cn?.attachments ?? [])];
  const home = role === "KAM" ? "/kam" : role === "ACCOUNTS" ? "/accounts" : role === "MANAGEMENT" ? "/management" : "/ops";
  const kam = role === "KAM";
  const close = () => setDrawer(null);
  const addNote = async () => { setNerr(null); try { await api.comment(id, { text: note }); setNote(""); res.reload(); } catch (e) { setNerr((e as Error).message); } };
  const kv = (k: React.ReactNode, v: React.ReactNode, strong?: boolean) => <div className="kv" style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}><span style={strong ? { fontWeight: 700 } : undefined}>{k}</span><span>{v}</span></div>;
  const Info = ({ l, v }: { l: string; v: React.ReactNode }) => <div><div className="sect-label" style={{ margin: 0, fontSize: 10 }}>{l}</div><div style={{ fontSize: 13 }}>{v ?? "—"}</div></div>;
  return (
    <RoleGate roles={["OPS", "ACCOUNTS", "MANAGEMENT", "KAM"]}>
      <div className="page">
        <Head back={{ href: home, label: "Back to cases" }} crumbs={`Lost & Damage / Cases / ${c ? awbOf(c) : id}`}
          title={c ? <span style={{ display: "flex", gap: 10, alignItems: "center" }}><span className="mono">{awbOf(c)}</span><TypeTag t={c.case_type} /><SourceChip s={c.source} /><StatusChip s={c.status} /><span className="note-sm" style={{ fontWeight: 400 }}>Ageing {ageDays(c.created_at) ?? "—"} days · Case ID {c.case_id}</span></span> : "Case"}
          actions={c && c.is_open !== false && <>
            {role === "OPS" && <button className="btn" onClick={() => setDrawer({ k: "status", d: "ESCALATE" })}>Escalate</button>}
            {(role === "OPS" || role === "ACCOUNTS") && <button className="btn" onClick={() => setDrawer({ k: "handoff" })}>{role === "OPS" ? "Send to Accounts" : "Return to OPS"}</button>}
            {role === "ACCOUNTS" && <button className="btn" onClick={() => setDrawer({ k: "exception" })}>Ask management approval</button>}
            {role === "ACCOUNTS" && <button className="btn btn-primary" onClick={() => setDrawer({ k: "release" })}>Release client CN</button>}
            {(role === "OPS" || role === "ACCOUNTS") && <button className="btn btn-primary" onClick={() => setDrawer({ k: "status" })}>Update status</button>}
          </>} />
        <Status loading={res.loading} error={res.error} />
        {c && <>
          {c.claim_deadline && ["MARKED", "CLAIM_RAISED", "FOLLOW_UP"].includes(c.status) && (
            <div className="banner amber" style={{ marginBottom: 16 }}><div><b>Raise the claim with {courierOf(c)} by {dayFull(c.claim_deadline)}.</b> The courier claim window closes in {Math.max(0, Math.ceil((new Date(c.claim_deadline).getTime() - Date.now()) / 86_400_000))} days.</div></div>)}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1.1fr", gap: 18, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="card card-pad"><h2>Shipment</h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
                  <Info l="Order no." v={c.orderno} /><Info l="Client" v={clientOf(c)} /><Info l="Courier" v={courierOf(c)} /><Info l="Picked up" v={dayFull(c.picked_up_date)} />
                  <Info l="Client reported" v={dayFull(c.client_reported_on)} /><Info l="Client ticket" v={c.client_ticket_ref} /><Info l={`Marked ${c.case_type === "DAMAGED" ? "damaged" : "lost"}`} v={`${dayFull(c.created_at)}${c.marked?.name ? ` · by ${c.marked.name} (${c.marked.role ?? ""})` : ""}`} /><Info l="Pending at" v={c.pending_at} />
                </div>
                <div style={{ marginTop: 14 }}><Info l="Marking reason" v={c.mark_reason} /></div>
                {c.ops_remarks && <div style={{ marginTop: 10 }}><Info l="OPS remarks" v={c.ops_remarks} /></div>}
              </div>
              <div className="card card-pad"><div style={{ display: "flex", justifyContent: "space-between" }}><h2>Liability &amp; claim</h2><span className="note-sm">Terms from signed L&amp;D agreements · amounts excl. GST</span></div>
                {kv("Declared / invoice value", rs(c.invoice_amount))}
                {kv("Client liability", liab(c.client_liability, rs, c.client_cof_only))}
                {!kam && kv("Courier liability", liab(c.courier_liability, rs, c.courier_cof_only))}
                {!kam && kv("Liability gap (SD absorbs)", c.client_cof_only || c.courier_cof_only ? liab(0, rs, true) : c.client_liability == null || c.courier_liability == null ? liab(null) : rs(c.client_liability - c.courier_liability))}
                {!kam && kv("Courier CN received", rs(c.courier_cn_amount ?? 0))}
                {!kam && c.sd_gap !== undefined && kv("SD gap", <span className="t-orange">{rs(c.sd_gap)}</span>)}
                {kv("Client CN", c.client_cn ? <span><span className="mono">{c.client_cn.number}</span> · {rs(c.client_cn.amount)} · {dayFull(c.client_cn.date)}</span> : ["COURIER_CN_RECEIVED", "APPROVED_FOR_RELEASE"].includes(c.status) ? <span className="chip green">Ready to release</span> : <span className="chip red">Locked until courier CN</span>, true)}
                {c.liability_warning && <p className="note-sm t-orange">Liability terms missing for this client or courier; amounts default to invoice value.</p>}
              </div>
              <div className="card card-pad"><h2>Attachments ({files.length})</h2>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{files.map((f, i) => (
                  <div key={i} className="fileline" style={{ marginTop: 0 }}><span className={`chip ${ext(f.name) === "PDF" ? "red" : "blue"}`}>{ext(f.name)}</span><div><div>{f.url ? <a className="link" href={f.url} target="_blank" rel="noreferrer">{f.name}</a> : f.name}</div><div className="sub">{f.uploaded?.name ?? ""} · {dayFull(f.uploaded?.at)}</div></div></div>))}
                  {!files.length && <span className="note-sm">No attachments</span>}</div></div>
            </div>
            <div className="card card-pad"><div style={{ display: "flex", justifyContent: "space-between" }}><h2>Timeline</h2><span className="note-sm">Audit trail · newest first</span></div>
              <div className="timeline">{events.map((e, i) => (
                <div key={e.id ?? i} style={{ display: "flex", gap: 10, paddingBottom: 14 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: i === 0 ? "var(--red)" : "#d1d5db", marginTop: 5, flex: "none" }} />
                  <div><b style={{ fontSize: 13 }}>{EVT[e.type] ?? String(e.type ?? "").replace(/_/g, " ").toLowerCase().replace(/^./, (x: string) => x.toUpperCase())}{e.to_status && e.type !== "MARKED" ? ` → ${e.to_status}` : ""}</b>
                    <div className="note-sm">{dayFull(e.at)}{e.at ? `, ${new Date(e.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""} · {e.by?.name ?? "System"}{e.by?.role ? ` (${e.by.role})` : ""}</div>
                    {e.text && <div style={{ fontSize: 12.5, marginTop: 2 }}>{e.text}</div>}
                    {(e.attachments ?? []).map((a: Row, j: number) => <div key={j} className="note-sm t-red" style={{ textDecoration: "underline" }}>{a.name}</div>)}</div>
                </div>))}</div>
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                <b style={{ fontSize: 13 }}>Add internal note</b>
                <textarea className="textarea" style={{ width: "100%", minHeight: 64, marginTop: 8 }} placeholder="Visible to OPS, KAM, Accounts and Management" value={note} onChange={(e) => setNote(e.target.value)} />
                {nerr && <p className="errline">{nerr}</p>}
                <div style={{ textAlign: "right", marginTop: 8 }}><button className="btn btn-dark" disabled={!note.trim()} onClick={addNote}>Add note</button></div>
              </div>
            </div>
          </div>
        </>}
        {c && drawer?.k === "status" && <UpdateStatusDrawer cases={[{ ...c, _id: id }]} initial={drawer.d} onClose={close} onDone={res.reload} />}
        {drawer?.k === "handoff" && <HandoffDrawer id={id} to={role === "OPS" ? "ACCOUNTS" : "OPS"} onClose={close} onDone={res.reload} />}
        {c && drawer?.k === "exception" && <ApprovalDrawer c={{ ...c, _id: id }} onClose={close} onDone={res.reload} />}
        {c && drawer?.k === "release" && <ReleaseDrawer cases={[{ ...c, _id: id }]} onClose={close} onDone={res.reload} />}
        <p className="note-sm" style={{ marginTop: 16 }}><Link className="link" href={home}>‹ Back to cases</Link></p>
      </div>
    </RoleGate>
  );
}
