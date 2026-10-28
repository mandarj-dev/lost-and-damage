"use client";
// Figma drawers bound to the live endpoints: Update status, Release client CN, Ask management approval, Record settlement, Return / send.
import { useState, type ReactNode } from "react";
import { api, type Disposition, type EvidenceFile, type LiabilityMaster, type Row } from "@/lib/api";
import { rowId, useApi } from "./ApiKit";
import { Drawer } from "./Drawer";
import { DropUpload, awbOf, clientOf, courierOf, dayMon, liab, nf, rs, StatusChip, TypeTag } from "./FigmaKit";

const iso = (d: string) => (d ? new Date(d).toISOString() : new Date().toISOString());
const today = () => new Date().toISOString().slice(0, 10);
const L = ({ label, req, children }: { label: string; req?: boolean; children: ReactNode }) => <label className="field" style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 500 }}>{label}{req && " *"}{children}</label>;

function useSubmit(fn: () => Promise<unknown>, done: () => void) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => { setBusy(true); setErr(null); try { await fn(); done(); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  return { busy, err, go };
}
const Foot = ({ note, err, busy, onClose, go, label, disabled }: { note?: ReactNode; err: string | null; busy: boolean; onClose: () => void; go: () => void; label: string; disabled?: boolean }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
    <span className="note-sm" style={{ flex: 1 }}>{err ? <span className="errline">{err}</span> : note}</span>
    <button className="btn" onClick={onClose}>Cancel</button>
    <button className="btn btn-dark" disabled={busy || disabled} onClick={go}>{busy ? "Saving…" : label}</button>
  </div>
);
type P = { onClose: () => void; onDone: () => void };

const DISPO: { v: Disposition; t: string; d: string }[] = [
  { v: "CLAIM_SENT", t: "Claim raised to courier", d: "Claim filed with the courier" },
  { v: "FOLLOW_UP", t: "Follow-up sent", d: "Chased the courier again" },
  { v: "CN_RECEIVED", t: "CN received (full or partial)", d: "One CN can cover several AWBs of the same courier" },
  { v: "CN_REJECTED", t: "Courier rejected", d: "Courier refused the claim; reason required" },
  { v: "FOUND", t: "Found / delivered", d: "Shipment traced; case closes with no liability" },
  { v: "ESCALATE", t: "Escalate to management", d: "Management decides the case" },
];

/** POST /disputes/status (+ GET /checks for the courier CN number). */
export function UpdateStatusDrawer({ cases, initial = "CLAIM_SENT", onClose, onDone }: P & { cases: Row[]; initial?: Disposition }) {
  const [d, setD] = useState<Disposition>(initial);
  const [remarks, setRemarks] = useState("");
  const [reason, setReason] = useState("");
  const [cn, setCn] = useState({ no: "", date: today(), mode: "", month: "" });
  const [amt, setAmt] = useState<Record<string, string>>(Object.fromEntries(cases.map((c) => [rowId(c), c.courier_cof_only ? "" : String(c.courier_liability ?? "")])));
  const [short, setShort] = useState<Record<string, string>>({});
  const [doc, setDoc] = useState<EvidenceFile[]>([]);
  const [check, setCheck] = useState<{ ok: boolean; t: string } | null>(null);
  const lines = cases.map((c) => ({ dispute_id: rowId(c), amount: Number(amt[rowId(c)] || 0), short_reason: short[rowId(c)] || undefined }));
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const claimed = cases.reduce((s, c) => s + (c.courier_liability ?? 0), 0);
  const isCn = d === "CN_RECEIVED";
  const s = useSubmit(() => api.updateStatus({ dispute_ids: cases.map(rowId), disposition: d, remarks: remarks || undefined, reason: reason || undefined,
    courier_cn: isCn ? { cn_number: cn.no, cn_date: iso(cn.date), total_amount: total, lines, document: doc[0], expected_mode: (cn.mode || undefined) as "UTR" | "FREIGHT_BILL" | undefined, expected_freight_month: cn.month || undefined } : undefined }), () => { onDone(); onClose(); });
  const one = DISPO.find((x) => x.v === d)!;
  const couriers = Array.from(new Set(cases.map(courierOf)));
  return (
    <Drawer title={<>Update status <small>for {cases.length} case{cases.length > 1 ? "s" : ""}</small></>} subtitle={`${couriers.join(", ")} · ${Array.from(new Set(cases.map((c) => (c.source === "API" ? "API" : "manual")))).join(" and ")}-marked`} onClose={onClose}
      footer={<Foot err={s.err} busy={s.busy} onClose={onClose} go={s.go} label={`Apply to ${cases.length} case${cases.length > 1 ? "s" : ""}`} disabled={(isCn && (!doc.length || !cn.no)) || (d === "CN_REJECTED" && !reason)} />}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="awb-chips" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{cases.map((c) => <span key={rowId(c)} className="chip grey mono" style={{ borderRadius: 6, fontWeight: 500 }}>{awbOf(c)} · {c.case_type === "DAMAGED" ? "Damaged" : "Lost"} · {c.source === "API" ? "API" : "Manual"}</span>)}</div>
        <L label="Disposition" req><select className="select" value={d} onChange={(e) => setD(e.target.value as Disposition)}>{DISPO.map((x) => <option key={x.v} value={x.v}>{x.t}</option>)}</select><span className="note-sm">{one.d}</span></L>
        {d === "CN_REJECTED" && <L label="Rejection reason" req><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></L>}
        {isCn && <>
          <b>Courier credit note</b>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <L label="CN number" req><input className="input mono" value={cn.no} onChange={(e) => setCn({ ...cn, no: e.target.value })}
              onBlur={() => cn.no && cases[0]?.courier_code && api.checkCn({ courier_code: cases[0].courier_code, courier_cn_number: cn.no }).then((r) => { const u = !!(r as Row)?.courier_cn?.is_used; setCheck({ ok: !u, t: u ? `CN number already recorded on ${((r as Row).courier_cn.case_ids ?? []).join(", ")}` : "CN number not used on any other case" }); }).catch((e) => setCheck({ ok: false, t: e.message }))} /></L>
            <L label="CN date" req><input className="input" type="date" value={cn.date} onChange={(e) => setCn({ ...cn, date: e.target.value })} /></L>
            <L label="Total CN amount" req><input className="input" readOnly value={rs(total)} /></L>
          </div>
          {check && <div className={check.ok ? "okline" : "errline"}>{check.ok ? "✓ " : ""}{check.t}</div>}
          <table className="tbl"><thead><tr><th>AWB</th><th className="num">Claimed</th><th className="num">CN amount</th><th>Result</th></tr></thead>
            <tbody>{cases.map((c) => { const a = Number(amt[rowId(c)] || 0); const full = a >= (c.courier_liability ?? 0) - 0.005; return (
              <tr key={rowId(c)}><td className="mono">{awbOf(c)}</td><td className="num">{liab(c.courier_liability, rs, c.courier_cof_only)}</td>
                <td className="num"><input className="input sm" style={{ width: 96, textAlign: "right" }} value={amt[rowId(c)] ?? ""} onChange={(e) => setAmt({ ...amt, [rowId(c)]: e.target.value })} />
                  {!full && <input className="input sm" style={{ marginTop: 6, width: 160 }} placeholder="Short-payment reason" value={short[rowId(c)] ?? ""} onChange={(e) => setShort({ ...short, [rowId(c)]: e.target.value })} />}</td>
                <td className={full ? "t-green strong" : "t-orange strong"}>{full ? "Full" : "Partial"}</td></tr>); })}
              <tr className="total"><td>Total</td><td className="num">{rs(claimed)}</td><td className="num">{rs(total)}</td><td className="t-green">Matches CN</td></tr></tbody></table>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <L label="Expected settlement"><select className="select" value={cn.mode} onChange={(e) => setCn({ ...cn, mode: e.target.value })}><option value="">Not known</option><option value="UTR">Bank transfer (UTR)</option><option value="FREIGHT_BILL">Freight bill adjustment</option></select></L>
            {cn.mode === "FREIGHT_BILL" && <L label="Freight month"><input className="input" type="month" value={cn.month} onChange={(e) => setCn({ ...cn, month: e.target.value })} /></L>}
          </div>
          <DropUpload value={doc} onChange={setDoc} max={1} hint="Required: CN document from courier" />
        </>}
        <L label="Remarks"><textarea className="textarea" placeholder="Visible in each case's timeline" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></L>
      </div>
    </Drawer>
  );
}

/** GET /checks (client CN) + POST /disputes/release. */
export function ReleaseDrawer({ cases, onClose, onDone }: P & { cases: Row[] }) {
  const [rel, setRel] = useState<Record<string, string>>(Object.fromEntries(cases.map((c) => [rowId(c), c.client_cof_only ? "" : String(c.client_liability ?? "")])));
  const [checked, setChecked] = useState(false);
  const [no, setNo] = useState("");
  const [date, setDate] = useState(today());
  const [att, setAtt] = useState<EvidenceFile[]>([]);
  const [remarks, setRemarks] = useState("");
  const [check, setCheck] = useState<{ ok: boolean; t: string } | null>(null);
  const total = cases.reduce((s, c) => s + Number(rel[rowId(c)] || 0), 0);
  const s = useSubmit(() => api.release({ checked, cases: cases.map((c) => ({ dispute_id: rowId(c), client_cn_number: no, client_cn_date: iso(date), amount: Number(rel[rowId(c)] || 0), attachments: att, remarks: remarks || undefined })) }), () => { onDone(); onClose(); });
  const T = (k: string) => cases.reduce((a, c) => a + (c[k] ?? 0), 0);
  const gap = (c: Row) => Number(rel[rowId(c)] || 0) - (c.courier_cn_amount ?? 0);
  return (
    <Drawer title={<>Release client CN <small>for {clientOf(cases[0] ?? {})}</small></>} subtitle={`${cases.length} case${cases.length > 1 ? "s" : ""} · one client CN`} onClose={onClose}
      footer={<Foot note={`The KAM sees these ${cases.length} cases move to Released.`} err={s.err} busy={s.busy} onClose={onClose} go={s.go} label={`Release ${rs(total)}`} disabled={!checked || !no || !att.length} />}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Client dues warning from the Figma is not shown: dues are not available from the backend yet. */}
        <table className="tbl"><thead><tr><th>AWB · Courier CN</th><th className="num">Item</th><th className="num">Client liab.</th><th className="num">Courier CN</th><th className="num">SD gap</th><th className="num">Release</th></tr></thead>
          <tbody>{cases.map((c) => (
            <tr key={rowId(c)}><td><div className="mono strong">{awbOf(c)}</div><div className="sub">{c.case_type === "DAMAGED" ? "Damaged" : "Lost"} · {courierOf(c)}</div></td>
              <td className="num">{rs(c.invoice_amount)}</td><td className="num">{liab(c.client_liability, rs, c.client_cof_only)}</td><td className="num">{rs(c.courier_cn_amount)}</td>
              <td className={`num${gap(c) > 0 ? " t-orange strong" : ""}`}>{rs(gap(c))}</td>
              <td className="num"><input className="input sm" style={{ width: 90, textAlign: "right" }} value={rel[rowId(c)] ?? ""} onChange={(e) => setRel({ ...rel, [rowId(c)]: e.target.value })} /></td></tr>))}
            <tr className="total"><td>Total</td><td className="num">{rs(T("invoice_amount"))}</td><td className="num">{rs(T("client_liability"))}</td><td className="num">{rs(T("courier_cn_amount"))}</td><td className="num t-orange">{rs(total - T("courier_cn_amount"))}</td><td className="num">{rs(total)}</td></tr></tbody></table>
        <p className="note-sm">Release defaults to client liability. SD gap = release − courier CN, absorbed by ShipDelight. Releasing above client liability sends that case to management.</p>
        <label className="check-card" style={{ display: "flex", gap: 10, border: "1px solid var(--line)", borderRadius: 10, padding: 14 }}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span><b>I have checked the courier CN documents</b><div className="note-sm">CN numbers, amounts and PDFs match what OPS entered. If not, close this and use Return to OPS.</div></span></label>
        <b>Client credit note</b>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <L label="Client CN number" req><input className="input mono" value={no} onChange={(e) => setNo(e.target.value)} onBlur={() => no && api.checkCn({ client_cn_number: no }).then((r) => { const u = !!(r as Row)?.is_used; setCheck({ ok: !u, t: u ? `Client CN number already used on ${(r as Row).case_id}` : "Client CN number not used before" }); }).catch((e) => setCheck({ ok: false, t: e.message }))} /></L>
          <L label="CN date" req><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></L>
          <L label="CN amount (excl. GST)" req><input className="input" readOnly value={rs(total)} /></L>
        </div>
        {check && <div className={check.ok ? "okline" : "errline"}>{check.ok ? "✓ " : ""}{check.t}</div>}
        <DropUpload value={att} onChange={setAtt} />
        <L label="Remarks"><textarea className="textarea" placeholder="Visible in each case's timeline" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></L>
      </div>
    </Drawer>
  );
}

const EXC = [
  { t: "Courier rejected – no CN", d: "Courier refused the claim; SD pays the client from its own pocket" },
  { t: "Claim filed after courier window", d: "Courier window closed before the claim" },
  { t: "Courier not responding", d: "No response after follow-ups" },
  { t: "Client L&D agreement overrides courier terms", d: "Client agreement commits SD to pay" },
];
/** GET /approvers + POST /disputes/exception. */
export function ApprovalDrawer({ c, onClose, onDone }: P & { c: Row }) {
  const approvers = useApi(() => api.approvers(), []);
  const [type, setType] = useState(EXC[0].t);
  const [just, setJust] = useState("");
  const [appr, setAppr] = useState("");
  const [by, setBy] = useState("");
  const [docs, setDocs] = useState<EvidenceFile[]>([]);
  const id = rowId(c);
  const s = useSubmit(() => api.requestException({ dispute_id: id, exception_type: type, justification: just, approver_user_id: appr, requested_amount: c.client_liability, needed_by: by ? iso(by) : undefined, documents: docs }), () => { onDone(); onClose(); });
  return (
    <Drawer title={<>Ask management approval <small>to release</small></>} subtitle="Release stays locked until management approves" onClose={onClose}
      footer={<Foot note="After approval the case returns to Ready to release. If rejected, it closes as an SD decision with no payout." err={s.err} busy={s.busy} onClose={onClose} go={s.go} label="Send for approval" disabled={!just || !appr || !docs.length} />}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="card card-pad" style={{ background: "var(--head-bg)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{awbOf(c)}</span><TypeTag t={c.case_type} /><StatusChip s={c.status} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 12, fontSize: 12.5 }}>
            <div><div className="sect-label" style={{ margin: 0 }}>Client · Order</div>{clientOf(c)} · {c.orderno ?? "—"}</div>
            <div><div className="sect-label" style={{ margin: 0 }}>Courier</div>{courierOf(c)}</div>
            <div><div className="sect-label" style={{ margin: 0 }}>Marked lost</div>{dayMon(c.created_at)} · {c.marked?.name ?? "—"}</div>
          </div>
        </div>
        {[["Item value (excl. GST)", c.invoice_amount, false], ["Client liability", c.client_liability, c.client_cof_only], ["Courier CN", c.courier_cn_amount ?? 0, false]].map(([k, v, cof]) => <div key={String(k)} className="kv" style={{ display: "flex", justifyContent: "space-between" }}><span>{k}</span><b>{liab(v, rs, cof)}</b></div>)}
        <div className="kv" style={{ display: "flex", justifyContent: "space-between" }}><b>Proposed client CN</b><b>{liab(c.client_liability, rs, c.client_cof_only)}</b></div>
        <div className="kv t-orange" style={{ display: "flex", justifyContent: "space-between" }}><b>ShipDelight absorbs</b><b>{c.client_cof_only ? liab(0, rs, true) : c.client_liability == null ? liab(null) : rs(c.client_liability - (c.courier_cn_amount ?? 0))}</b></div>
        <L label="Exception type" req><select className="select" value={type} onChange={(e) => setType(e.target.value)}>{EXC.map((x) => <option key={x.t}>{x.t}</option>)}</select><span className="note-sm">{EXC.find((x) => x.t === type)?.d}</span></L>
        <L label="Justification" req><textarea className="textarea" value={just} onChange={(e) => setJust(e.target.value)} /></L>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <L label="Approver" req><select className="select" value={appr} onChange={(e) => setAppr(e.target.value)}><option value="">{approvers.loading ? "Loading…" : approvers.error ?? "Choose"}</option>{(approvers.data ?? []).map((a) => <option key={String(a._id)} value={String(a._id)}>{a.name ?? String(a._id)}</option>)}</select></L>
          <L label="Needed by"><input className="input" type="date" value={by} onChange={(e) => setBy(e.target.value)} /></L>
        </div>
        <DropUpload value={docs} onChange={setDocs} disputeId={id} label="Supporting documents" hint="Client L&D agreement clause, client escalation mail" />
      </div>
    </Drawer>
  );
}

/** POST /disputes/{id}/handoff */
export function HandoffDrawer({ id, to, onClose, onDone }: P & { id: string; to: "OPS" | "ACCOUNTS" }) {
  const [remarks, setRemarks] = useState("");
  const s = useSubmit(() => api.handoff(id, { to, remarks: remarks || undefined }), () => { onDone(); onClose(); });
  return (
    <Drawer title={to === "OPS" ? "Return to OPS" : "Send to Accounts"} onClose={onClose} footer={<Foot err={s.err} busy={s.busy} onClose={onClose} go={s.go} label={to === "OPS" ? "Return to OPS" : "Send to Accounts"} />}>
      <L label="Remarks"><textarea className="textarea" placeholder="Visible in the case timeline" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></L>
    </Drawer>
  );
}

/** POST /settlements — bank transfer (UTR) or freight bill over one or several courier CNs of one courier. */
export function SettlementDrawer({ cns, onClose, onDone }: P & { cns: Row[] }) {
  const [mode, setMode] = useState<"UTR" | "FREIGHT_BILL">("UTR");
  const [f, setF] = useState({ utr: "", month: "", bill: "", on: today(), remarks: "" });
  const [amt, setAmt] = useState<Record<string, string>>(Object.fromEntries(cns.map((c) => [rowId(c), String((c.total_amount ?? 0) - (c.settled_amount ?? 0))])));
  const [proof, setProof] = useState<EvidenceFile[]>([]);
  const items = cns.map((c) => ({ courier_cn_id: rowId(c), amount: Number(amt[rowId(c)] || 0) }));
  const total = items.reduce((s, i) => s + i.amount, 0);
  const s = useSubmit(() => api.settle({ mode, utr: f.utr || undefined, freight_month: f.month || undefined, freight_bill_no: f.bill || undefined, amount: total, settled_on: iso(f.on), proof: proof[0], remarks: f.remarks || undefined, items }), () => { onDone(); onClose(); });
  return (
    <Drawer title={<>Record settlement <small>{courierOf(cns[0] ?? {})}</small></>} subtitle={`${cns.length} courier CN${cns.length > 1 ? "s" : ""} · part payments keep the balance open`} onClose={onClose}
      footer={<Foot err={s.err} busy={s.busy} onClose={onClose} go={s.go} label={`Record ${rs(total)}`} disabled={!proof.length || !total} />}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="seg"><button className={mode === "UTR" ? "on" : ""} onClick={() => setMode("UTR")}>Bank transfer</button><button className={mode === "FREIGHT_BILL" ? "on" : ""} onClick={() => setMode("FREIGHT_BILL")}>Freight bill adj.</button></div>
        {mode === "UTR" ? <L label="UTR" req><input className="input mono" value={f.utr} onChange={(e) => setF({ ...f, utr: e.target.value })} /></L> :
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><L label="Freight month" req><input className="input" type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></L><L label="Freight bill no."><input className="input" value={f.bill} onChange={(e) => setF({ ...f, bill: e.target.value })} /></L></div>}
        <table className="tbl"><thead><tr><th>Courier CN</th><th className="num">CN amount</th><th className="num">Balance</th><th className="num">This settlement</th></tr></thead>
          <tbody>{cns.map((c) => <tr key={rowId(c)}><td className="mono">{c.cn_number}</td><td className="num">{rs(c.total_amount)}</td><td className="num t-red">{rs((c.total_amount ?? 0) - (c.settled_amount ?? 0))}</td>
            <td className="num"><input className="input sm" style={{ width: 96, textAlign: "right" }} value={amt[rowId(c)] ?? ""} onChange={(e) => setAmt({ ...amt, [rowId(c)]: e.target.value })} /></td></tr>)}
            <tr className="total"><td>Total</td><td /><td /><td className="num">{rs(total)}</td></tr></tbody></table>
        <L label="Settled on" req><input className="input" type="date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} /></L>
        <DropUpload value={proof} onChange={setProof} max={1} label="Proof" hint="Bank advice or freight bill" />
        <L label="Remarks"><textarea className="textarea" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></L>
        <span className="note-sm">{nf(cns.length)} CN(s) selected</span>
      </div>
    </Drawer>
  );
}

/** Result of a liability term save, shown in the page's success banner. */
export type LiabilitySaved = { label: string; effectiveFrom: string; recalculated: number; failed: string[] };

/** POST /liability/terms (one master) or /liability/terms/courier-group (every code of a courier group): add or replace a dated liability term. */
export function LiabilityTermDrawer({ master, group, onClose, onDone }: { master: LiabilityMaster; group?: { name: string; label: string; codes: string[] }; onClose: () => void; onDone: (saved: LiabilitySaved) => void }) {
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [amount, setAmount] = useState(master.liability_amount == null ? "" : String(master.liability_amount));
  const [cof, setCof] = useState(master.cof);
  const parsed = amount.trim() === "" ? null : Number(amount.replace(/,/g, ""));
  const amountError = parsed !== null && !Number.isFinite(parsed) ? "Enter a number, e.g. 5000" : parsed !== null && parsed < 0 ? "Amount cannot be negative" : null;
  const label = group?.label ?? master.name ?? master.key;
  const term = { effective_from: effectiveFrom, liability_amount: parsed, cof };
  const s = useSubmit(async () => {
    if (group) {
      const r = await api.saveCourierGroupTerm({ courier_name: group.name, ...term });
      onDone({ label, effectiveFrom, recalculated: r.disputes_recalculated, failed: r.failed_codes.map((f) => `${f.courier_code}: ${f.error}`) });
    } else {
      const r = await api.saveLiabilityTerm({ entity_type: master.entity_type, key: master.key, ...term });
      onDone({ label, effectiveFrom, recalculated: r.disputes_recalculated, failed: [] });
    }
  }, onClose);
  const help = { fontSize: 12, color: "var(--muted)", fontWeight: 400 } as const;
  return (
    <Drawer title={group ? "Edit term for courier group" : "Edit liability term"} subtitle={group ? `${label} · ${group.codes.length} code${group.codes.length === 1 ? "" : "s"}: ${group.codes.join(", ")}` : `${label} · ${master.key}`} onClose={onClose}
      footer={<Foot note={group ? "Saved on every code, each with its own history and audit entry." : "Disputes picked up inside this term's window are recalculated."} err={s.err} busy={s.busy} onClose={onClose} go={s.go} label="Save term" disabled={!effectiveFrom || !!amountError} />}>
      <L label="Effective from" req>
        <input className={`input${effectiveFrom ? "" : " err"}`} type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        <span style={help}>{effectiveFrom ? "Applies to shipments picked up on or after this date (order date when there is no pickup date)." : "Pick a date."}</span>
      </L>
      <L label="Liability amount (max L)">
        <input className={`input${amountError ? " err" : ""}`} inputMode="decimal" placeholder="Leave blank for no maximum" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <span style={amountError ? { ...help, color: "var(--red)" } : help}>{amountError ?? "Invoice value up to this amount is payable; blank means not defined."}</span>
      </L>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={cof} onChange={(e) => setCof(e.target.checked)} style={{ marginTop: 2 }} />
        <span><b>COF</b><br /><span style={help}>Above the amount (or with no amount) the liability is COF only.</span></span>
      </label>
      <div className="card card-pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--head-bg)" }}>
        <span className="muted" style={{ fontSize: 13 }}>Shown as</span><LiabilityTermText amount={parsed} cof={cof} />
      </div>
    </Drawer>
  );
}

/** Liability master term: "Max ₹5,000 | COF"; COF pill alone without an amount; grey "Not defined" when neither (dispute screens keep liab()). */
export function LiabilityTermText({ amount, cof }: { amount: number | null | undefined; cof: boolean }) {
  const hasAmount = amount !== null && amount !== undefined;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      {hasAmount && <span><span className="muted" style={{ fontSize: 12 }}>Max </span><b>{rs(amount)}</b></span>}
      {hasAmount && cof && <span className="muted">|</span>}
      {cof && <span className="chip amber">COF</span>}
      {!hasAmount && !cof && <span className="chip grey">Not defined</span>}
    </span>
  );
}
