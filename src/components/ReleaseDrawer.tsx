"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Drawer, postJson } from "./Drawer";
import { FileDrop, type Uploaded } from "./FileDrop";
import { NumberCheckLine, useNumberCheck } from "./UpdateStatusDrawer";
import { Banner } from "./ui";
import type { CaseRow } from "@/lib/case-view";
import { dayShort, inr, isoDay } from "@/lib/format";
import { round2 } from "@/lib/rules";

/** Release brand CN: one brand credit note for all selected cases of a client. */
export function ReleaseDrawer({ cases, onClose }: { cases: CaseRow[]; onClose: () => void }) {
  const router = useRouter();
  const client = cases[0].client;
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(cases.map((c) => [c.id, String(c.clientLiability)])));
  const [why, setWhy] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [cnNumber, setCnNumber] = useState("");
  const [cnDate, setCnDate] = useState(isoDay());
  const [cnAmountEdit, setCnAmountEdit] = useState<string | null>(null);
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = useNumberCheck("brand-cn", cnNumber);

  const rows = useMemo(
    () =>
      cases.map((c) => {
        const amount = Number(amounts[c.id] ?? 0);
        const above = amount > c.clientLiability;
        return { c, amount, above, over: round2(amount - c.clientLiability), gap: Math.max(0, round2(amount - c.courierCnAmount)) };
      }),
    [cases, amounts],
  );
  const now = rows.filter((r) => !r.above);
  const approval = rows.filter((r) => r.above);
  const nowTotal = round2(now.reduce((s, r) => s + r.amount, 0));
  const approvalTotal = round2(approval.reduce((s, r) => s + r.amount, 0));
  const cnAmount = cnAmountEdit !== null ? Number(cnAmountEdit) : nowTotal;
  const dues = cases[0].duesAmount > 0 && cases[0].duesAgeDays >= 30;

  async function submit() {
    setError(null);
    if (rows.some((r) => !(r.amount > 0))) return setError("Enter a release amount for every case.");
    if (approval.some((r) => !why[r.c.id]?.trim())) return setError("Add the reason for each case released above brand liability.");
    if (now.length) {
      if (!checked) return setError("Confirm that you have checked the courier CN documents.");
      if (!cnNumber.trim()) return setError("Enter the brand CN number.");
      if (check === "used") return setError("This brand CN number was already used.");
      if (round2(cnAmount) !== nowTotal) return setError(`Brand CN amount (${inr(cnAmount)}) must equal the amount released now (${inr(nowTotal)}).`);
      if (files.length === 0) return setError("Attach the brand credit note.");
    }
    setBusy(true);
    try {
      await postJson("/api/cases/release", {
        items: rows.map((r) => ({ caseId: r.c.id, amount: r.amount, justification: why[r.c.id] })),
        brandCn: now.length ? { cnNumber: cnNumber.trim(), cnDate, amount: cnAmount } : undefined,
        checked,
        attachments: files,
        remarks: remarks.trim() || undefined,
      });
      onClose();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const label = now.length && approval.length ? `Release ${inr(nowTotal)} and send ${approval.length} for approval` : now.length ? `Release ${inr(nowTotal)}` : `Send ${approval.length} for approval`;

  return (
    <Drawer
      title={cases.length === 1 ? "Release CN to brand" : `Release CN to brand · ${cases.length} cases`}
      subtitle={`${client} · one brand CN for all selected cases`}
      onClose={onClose}
      pinned={
        <>
          {now.length > 0 ? <FileDrop files={files} onChange={setFiles} required title="Attachments" help="Required: the brand credit note. Add any client mail as well." /> : <div />}
          <div className="field">
            <div className="sect" style={{ margin: "0 0 8px" }}>Remarks</div>
            <textarea className="textarea" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Visible in each case's timeline" />
          </div>
        </>
      }
      footer={
        <>
          {error && <div className="msg errline">{error}</div>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "Saving…" : label}</button>
        </>
      }
    >
      {dues && (
        <Banner tone="amber">
          <b>{client} has {inr(cases[0].duesAmount)} outstanding for more than 30 days.</b> You can still release; this warning is recorded in the case timeline.
        </Banner>
      )}

      <div>
        <div className="sect">Cases and amounts</div>
        <div className="mini-tbl">
          <table>
            <thead><tr><th>AWB · courier CN</th><th className="num">Item</th><th className="num">Brand liab.</th><th className="num">Courier CN</th><th className="num">SD gap</th><th className="num">Release</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.c.id} className={r.above ? "warn" : ""}>
                  <td>
                    <div className="mono">{r.c.awb}</div>
                    <div className="lbl2">{r.c.type === "LOST" ? "Lost" : "Damaged"} · {r.c.courier}{r.c.courierCnAmount > 0 && r.c.courierCnAmount < r.c.courierLiability ? " · partial" : ""}</div>
                    {r.c.courierCn && <div className="lbl2"><span className="link mono">{r.c.courierCn.number}</span> · by {r.c.courierCn.by} ({r.c.courierCn.byRole === "OPS" ? "OPS" : "Accounts"})</div>}
                    {r.c.releaseApproved && !r.c.courierCn && <div className="lbl2 t-purple">Approved without courier CN</div>}
                    {r.above && <div className="lbl2 t-purple" style={{ fontWeight: 600 }}>{inr(r.over)} above brand liability · needs approval</div>}
                  </td>
                  <td className="num">{inr(r.c.itemValue)}</td>
                  <td className="num">{inr(r.c.clientLiability)}</td>
                  <td className="num">{inr(r.c.courierCnAmount)}</td>
                  <td className={`num${r.gap > 0 ? " t-orange" : ""}`} style={r.gap > 0 ? { fontWeight: 600 } : undefined}>{r.gap > 0 ? inr(r.gap) : "₹0"}</td>
                  <td className="num"><input className="input sm" inputMode="decimal" value={amounts[r.c.id] ?? ""} onChange={(e) => setAmounts({ ...amounts, [r.c.id]: e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="totrow">
                <td>Total</td>
                <td className="num">{inr(round2(cases.reduce((s, c) => s + c.itemValue, 0)))}</td>
                <td className="num">{inr(round2(cases.reduce((s, c) => s + c.clientLiability, 0)))}</td>
                <td className="num">{inr(round2(cases.reduce((s, c) => s + c.courierCnAmount, 0)))}</td>
                <td className="num t-orange">{inr(round2(rows.reduce((s, r) => s + r.gap, 0)))}</td>
                <td className="num">{inr(round2(rows.reduce((s, r) => s + r.amount, 0)))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="note-sm" style={{ marginTop: 8 }}>Release defaults to brand liability. SD gap = release – courier CN, absorbed by ShipDelight. Amounts are product value without GST.</p>
      </div>

      {approval.map((r) => (
        <div className="field" key={r.c.id}>
          <div className="lbl">Reason for releasing above brand liability on {r.c.awb} *</div>
          <textarea className="textarea" value={why[r.c.id] ?? ""} onChange={(e) => setWhy({ ...why, [r.c.id]: e.target.value })} placeholder="e.g. Shipping charge refund agreed with client; see attached mail." />
        </div>
      ))}

      {now.length > 0 && (
        <>
          <label className="check-card">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <div><b>I have checked the courier CN documents</b><span>CN numbers, amounts and PDFs match what OPS entered. If not, close this and use Return to OPS.</span></div>
          </label>

          <div>
            <div className="sect">Brand credit note</div>
            <div className="grid3">
              <div className="field"><div className="lbl">Brand CN number *</div><input className={`input mono${check === "used" ? " err" : ""}`} value={cnNumber} onChange={(e) => setCnNumber(e.target.value)} placeholder="e.g. SD/CN/26-27/00412" /></div>
              <div className="field"><div className="lbl">CN date *</div><input className="input" type="date" value={cnDate} max={isoDay()} onChange={(e) => setCnDate(e.target.value)} /></div>
              <div className="field"><div className="lbl">CN amount (excl. GST) *</div><input className="input" inputMode="decimal" value={cnAmountEdit ?? String(nowTotal)} onChange={(e) => setCnAmountEdit(e.target.value)} /></div>
            </div>
            <div style={{ marginTop: 8 }}><NumberCheckLine state={check} freeText="Brand CN number not used before" /></div>
            <p className="note-sm" style={{ marginTop: 6 }}>
              This CN covers the {now.length} case{now.length === 1 ? "" : "s"} released now ({inr(nowTotal)}).
              {approval.length > 0 && " The case sent for approval gets its own CN after approval."}
            </p>
          </div>
        </>
      )}

      <div className="sumtiles">
        <div className="sumtile green"><div className="l">Release now</div><div className="v">{now.length} case{now.length === 1 ? "" : "s"} · {inr(nowTotal)}</div><div className="s">Cases close as Released</div></div>
        <div className="sumtile purple"><div className="l">Send for management approval</div><div className="v">{approval.length} case{approval.length === 1 ? "" : "s"} · {inr(approvalTotal)}</div><div className="s">Moves to Pending approval</div></div>
      </div>
      <p className="note-sm" style={{ marginTop: -6 }}>Cases: {cases.map((c) => `${c.awb} (${dayShort(c.markedAt)})`).join(", ")}</p>
    </Drawer>
  );
}
