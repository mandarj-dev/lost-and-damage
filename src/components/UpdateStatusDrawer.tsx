"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Drawer, postJson } from "./Drawer";
import { FileDrop, type Uploaded } from "./FileDrop";
import { factsOfRow, type CaseRow } from "@/lib/case-view";
import { day, inr, isoDay } from "@/lib/format";
import { allowedDispositions, round2 } from "@/lib/rules";
import { ESCALATION_TYPES, SHORT_PAYMENT_REASONS, type Disposition, type Role } from "@/lib/types";

const OPTIONS: { id: Disposition; title: string; desc: string }[] = [
  { id: "CLAIM_SENT", title: "Claim email sent to courier", desc: "First claim raised with invoice and evidence" },
  { id: "FOLLOW_UP", title: "Follow-up sent", desc: "Reminder to courier; resets follow-up clock" },
  { id: "CN_RECEIVED", title: "CN received (full or partial)", desc: "One CN can cover several AWBs of the same courier" },
  { id: "CN_REJECTED", title: "CN rejected by courier", desc: "Courier denied the claim" },
  { id: "FOUND", title: "Shipment found / delivered / RTO", desc: "Close case with no liability" },
  { id: "ESCALATE", title: "Escalate to management", desc: "Needs a decision above OPS" },
];

/** Hook: is this CN / brand CN number already taken? Debounced check against the server. */
export function useNumberCheck(kind: "courier-cn" | "brand-cn", value: string) {
  const [state, setState] = useState<"idle" | "checking" | "free" | "used">("idle");
  useEffect(() => {
    const v = value.trim();
    if (!v) { setState("idle"); return; }
    setState("checking");
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/checks?kind=${kind}&number=${encodeURIComponent(v)}`);
        const data = await res.json();
        setState(data.used ? "used" : "free");
      } catch {
        setState("idle");
      }
    }, 350);
    return () => clearTimeout(t);
  }, [kind, value]);
  return state;
}

export function NumberCheckLine({ state, freeText }: { state: string; freeText: string }) {
  if (state === "free") return <div className="okline"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7.5l2.5 2.5L11 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>{freeText}</div>;
  if (state === "used") return <div className="errline">This number is already used. Check it and try again.</div>;
  if (state === "checking") return <div className="note-sm">Checking…</div>;
  return null;
}

export function UpdateStatusDrawer({
  cases, role, mode = "update", onClose,
}: {
  cases: CaseRow[];
  role: string;
  /** "escalate" opens only the Escalate-to-management form; "update" has every other status. */
  mode?: "update" | "escalate";
  onClose: () => void;
}) {
  const router = useRouter();
  const escalating = mode === "escalate";
  const allowed = useMemo(
    () => OPTIONS.filter((o) => (o.id === "ESCALATE") === escalating && cases.every((c) => allowedDispositions(role as Role, factsOfRow(c)).includes(o.id))),
    [cases, role, escalating],
  );
  const [disp, setDisp] = useState<Disposition | null>(allowed[0]?.id ?? null);
  const [cnNumber, setCnNumber] = useState("");
  const [cnDate, setCnDate] = useState(isoDay());
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(cases.map((c) => [c.id, String(c.courierLiability)])));
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [totalEdit, setTotalEdit] = useState<string | null>(null);
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [remarks, setRemarks] = useState("");
  const [rejection, setRejection] = useState("");
  const [escType, setEscType] = useState<string>(ESCALATION_TYPES[0]);
  const [escText, setEscText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cnCheck = useNumberCheck("courier-cn", disp === "CN_RECEIVED" ? cnNumber : "");

  const courier = cases[0]?.courier ?? "";
  const sub =
    role === "ACCOUNTS" && cases.some((c) => c.source === "MANUAL")
      ? `${courier} · OPS-marked: Accounts can add follow-ups only`
      : `${courier} · all ${cases.every((c) => c.source === "MANUAL") ? "manually marked" : "API-marked"}`;

  const lines = cases.map((c) => {
    const amount = Number(amounts[c.id] ?? 0);
    return { c, amount, claimed: c.courierLiability, partial: amount > 0 && amount < c.courierLiability, over: amount > c.courierLiability };
  });
  const sum = round2(lines.reduce((s, l) => s + (Number.isFinite(l.amount) ? l.amount : 0), 0));
  const claimedSum = round2(lines.reduce((s, l) => s + l.claimed, 0));
  const total = totalEdit !== null ? Number(totalEdit) : sum;
  const needsProof = disp === "CN_RECEIVED";

  async function submit() {
    setError(null);
    if (!disp) return;
    if (disp === "CN_RECEIVED") {
      if (!cnNumber.trim()) return setError("Enter the courier CN number.");
      if (cnCheck === "used") return setError("This CN number is already recorded on another case.");
      if (lines.some((l) => !(l.amount > 0))) return setError("Enter a CN amount for every AWB.");
      if (lines.some((l) => l.over)) return setError("A CN amount is more than the amount claimed.");
      if (lines.some((l) => l.partial && !reasons[l.c.id])) return setError("Choose a short-payment reason for each partial AWB.");
      if (round2(total) !== sum) return setError(`Total CN amount (${inr(total)}) must match the AWB amounts (${inr(sum)}).`);
      if (files.length === 0) return setError("Attach the courier CN document.");
    }
    if (disp === "CN_REJECTED" && !rejection.trim()) return setError("Add the reason the courier gave.");
    if (disp === "ESCALATE" && !escText.trim()) return setError("Add a justification for management.");
    setBusy(true);
    try {
      await postJson("/api/cases/disposition", {
        caseIds: cases.map((c) => c.id),
        disposition: disp,
        remarks: remarks.trim() || undefined,
        attachments: files,
        cn: disp === "CN_RECEIVED" ? { cnNumber: cnNumber.trim(), cnDate, totalAmount: total, lines: lines.map((l) => ({ caseId: l.c.id, amount: l.amount, shortReason: reasons[l.c.id] })) } : undefined,
        rejectionReason: disp === "CN_REJECTED" ? rejection.trim() : undefined,
        escalation: disp === "ESCALATE" ? { type: escType, justification: escText.trim() } : undefined,
      });
      onClose();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Drawer
      title={escalating ? "Escalate to management" : cases.length === 1 ? "Update status" : `Update status · ${cases.length} cases`}
      subtitle={escalating ? "Management decides what happens next. Include everything they need." : sub}
      onClose={onClose}
      pinned={disp && disp !== "FOUND" && (
        <>
          <FileDrop files={files} onChange={setFiles} required={needsProof}
            help={needsProof ? "Required: CN document from courier" : disp === "CLAIM_SENT" ? "Claim email, invoice, damage photos" : disp === "ESCALATE" ? "Courier mails, claim copy, call notes" : "Optional supporting files"} />
          <div className="field">
            <div className="sect" style={{ margin: "0 0 8px" }}>Remarks</div>
            <textarea className="textarea" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={cases.length > 1 ? "Visible in each case's timeline" : "Visible in the case timeline"} />
          </div>
        </>
      )}
      footer={
        <>
          {error && <div className="msg errline">{error}</div>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || !disp} onClick={submit}>
            {busy ? "Saving…" : escalating ? "Send to management" : cases.length === 1 ? "Apply" : `Apply to ${cases.length} cases`}
          </button>
        </>
      }
    >
      {!escalating && <div className="awb-chips">
        {cases.map((c) => <span key={c.id} className="awb-chip">{c.awb} · {c.type === "LOST" ? "Lost" : "Damage"}</span>)}
      </div>}

      {!escalating && <div>
        <div className="sect">Disposition</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {allowed.length === 0 && <div className="errline">You cannot update the selected cases.</div>}
          {allowed.map((o) => (
            <button type="button" key={o.id} className={`radio-card${disp === o.id ? " on" : ""}`} onClick={() => { setDisp(o.id); setError(null); }}>
              <span className="r" />
              <span><div className="t">{o.title}</div><div className="d">{o.desc}</div></span>
            </button>
          ))}
        </div>
      </div>}

      {disp === "CN_RECEIVED" && (
        <>
          <div>
            <div className="sect">Credit note</div>
            <div className="grid3">
              <div className="field"><div className="lbl">CN number *</div><input className={`input mono${cnCheck === "used" ? " err" : ""}`} value={cnNumber} onChange={(e) => setCnNumber(e.target.value)} placeholder="e.g. DLV/CN/2026/04418" /></div>
              <div className="field"><div className="lbl">CN date *</div><input className="input" type="date" value={cnDate} max={isoDay()} onChange={(e) => setCnDate(e.target.value)} /></div>
              <div className="field"><div className="lbl">Total CN amount *</div><input className="input" inputMode="decimal" value={totalEdit ?? String(sum)} onChange={(e) => setTotalEdit(e.target.value)} /></div>
            </div>
            <div style={{ marginTop: 8 }}><NumberCheckLine state={cnCheck} freeText="CN number not used on any other case" /></div>
          </div>
          <div className="mini-tbl">
            <table>
              <thead><tr><th>AWB</th><th className="num">Claimed</th><th className="num">CN amount</th><th>Result</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.c.id}>
                    <td className="mono">{l.c.awb}</td>
                    <td className="num">{inr(l.claimed)}</td>
                    <td className="num"><input className="input sm" inputMode="decimal" value={amounts[l.c.id] ?? ""} onChange={(e) => setAmounts({ ...amounts, [l.c.id]: e.target.value })} /></td>
                    <td>{l.over ? <span className="res-bad">More than claim</span> : l.partial ? <span className="res-warn">Partial −{inr(l.claimed - l.amount)}</span> : l.amount > 0 ? <span className="res-ok">Full</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="totrow"><td>Total</td><td className="num">{inr(claimedSum)}</td><td className="num">{inr(sum)}</td><td>{round2(total) === sum ? <span className="res-ok">Matches CN</span> : <span className="res-bad">Differs from CN</span>}</td></tr>
              </tfoot>
            </table>
          </div>
          {lines.filter((l) => l.partial).map((l) => (
            <div key={l.c.id} className="field">
              <div className="lbl">Short-payment reason for {l.c.awb} *</div>
              <select className="select" value={reasons[l.c.id] ?? ""} onChange={(e) => setReasons({ ...reasons, [l.c.id]: e.target.value })}>
                <option value="">Choose a reason</option>
                {SHORT_PAYMENT_REASONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
          ))}
        </>
      )}

      {disp === "CN_REJECTED" && (
        <div className="field"><div className="lbl">Reason given by the courier *</div><textarea className="textarea" value={rejection} onChange={(e) => setRejection(e.target.value)} placeholder="e.g. Claim filed after the window; no open-delivery POD" /></div>
      )}

      {disp === "ESCALATE" && (
        <>
          <div className="sect" style={{ margin: 0 }}>What management will see</div>
          {cases.map((c) => (
            <div key={c.id} className="case-facts">
              <div className="cf-head"><span className="mono">{c.awb} · {c.type === "LOST" ? "Lost" : "Damage"}</span><span className={`chip ${c.chip.tone}`}>{c.chip.label}</span></div>
              <dl>
                <div><dt>Client</dt><dd>{c.client}</dd></div>
                <div><dt>Courier</dt><dd>{c.courier}</dd></div>
                <div><dt>Order</dt><dd>{c.orderId ?? "—"}</dd></div>
                <div><dt>Item value</dt><dd>{inr(c.itemValue)}</dd></div>
                <div><dt>Courier liability</dt><dd>{inr(c.courierLiability)}</dd></div>
                <div><dt>Brand liability</dt><dd>{inr(c.clientLiability)}</dd></div>
                <div><dt>Marked</dt><dd>{day(c.markedAt)} by {c.markedBy}</dd></div>
                <div><dt>Open for</dt><dd>{c.ageDays} days</dd></div>
                <div><dt>Courier CN</dt><dd>{c.courierCn ? `${c.courierCn.number} · ${inr(c.courierCnAmount)}` : "Not received"}</dd></div>
                <div style={{ gridColumn: "1 / -1" }}><dt>Last action</dt><dd>{c.lastAction ? `${c.lastAction.label} · ${day(c.lastAction.at)} by ${c.lastAction.by}` : "—"}</dd></div>
              </dl>
            </div>
          ))}
          <div className="field"><div className="lbl">What are you escalating? *</div>
            <select className="select" value={escType} onChange={(e) => setEscType(e.target.value)}>{ESCALATION_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          </div>
          <div className="field"><div className="lbl">Justification *</div><textarea className="textarea" style={{ minHeight: 96 }} value={escText} onChange={(e) => setEscText(e.target.value)} placeholder="What has been tried (claims, follow-ups, calls), and what decision do you need?" /></div>
        </>
      )}

    </Drawer>
  );
}
