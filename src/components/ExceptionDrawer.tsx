"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Drawer, postJson } from "./Drawer";
import { FileDrop, type Uploaded } from "./FileDrop";
import { Chip, TypeTag } from "./ui";
import type { CaseRow } from "@/lib/case-view";
import { day, inr, isoDay } from "@/lib/format";
import { EXCEPTION_TYPES } from "@/lib/types";

/** Release without courier CN: an exception that management must approve first. */
export function ExceptionDrawer({ c, onClose }: { c: CaseRow; onClose: () => void }) {
  const router = useRouter();
  const [proposed, setProposed] = useState(String(c.clientLiability));
  const [type, setType] = useState<string>(c.status === "COURIER_REJECTED" ? EXCEPTION_TYPES[0] : "");
  const [text, setText] = useState("");
  const [needed, setNeeded] = useState(isoDay(new Date(Date.now() + 3 * 86_400_000)));
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = Number(proposed) || 0;

  async function submit() {
    setError(null);
    if (!(amount > 0)) return setError("Enter the proposed brand CN amount.");
    if (!type) return setError("Choose the exception type.");
    if (!text.trim()) return setError("Explain why SD should pay without a courier CN.");
    if (files.length === 0) return setError("Attach supporting documents.");
    setBusy(true);
    try {
      await postJson("/api/cases/exception", {
        caseId: c.id, exceptionType: type, justification: text.trim(), proposedAmount: amount,
        approver: "Management – L&D owner", neededBy: needed, documents: files,
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
      title="Release without courier CN"
      subtitle="Exception · needs management approval before release"
      onClose={onClose}
      pinned={<FileDrop files={files} onChange={setFiles} required title="Supporting documents" help="e.g. client L&D agreement clause, client escalation mail" />}
      footer={
        <>
          {error && <div className="msg errline">{error}</div>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-purple" disabled={busy} onClick={submit}>{busy ? "Sending…" : "Send for approval"}</button>
        </>
      }
    >
      <div className="card card-pad" style={{ padding: 16 }}>
        <div className="head-line" style={{ marginBottom: 12 }}>
          <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{c.awb}</span>
          <TypeTag type={c.type} />
          <Chip tone={c.chip.tone}>{c.chip.label}</Chip>
        </div>
        <div className="info c2">
          <div><div className="lbl">Client · Order</div><div className="val">{c.client} · {c.orderId ?? "—"}</div></div>
          <div><div className="lbl">Courier</div><div className="val">{c.courier}</div></div>
          <div><div className="lbl">Marked {c.type === "LOST" ? "lost" : "damaged"}</div><div className="val">{day(c.markedAt)} · by {c.markedBy}{c.source === "MANUAL" ? ` (${c.markedByRole === "OPS" ? "OPS" : ""})` : ""}</div></div>
          {c.status === "COURIER_REJECTED" && <div><div className="lbl">Courier rejection</div><div className="val">{c.chip.sub}</div></div>}
        </div>
      </div>

      <div>
        <div className="sect">Amounts</div>
        <div className="kv"><span className="k">Item value (excl. GST)</span><span>{inr(c.itemValue)}</span></div>
        <div className="kv"><span className="k">Brand liability</span><span>{inr(c.clientLiability)}</span></div>
        <div className="kv"><span className="k">Courier CN</span><span>₹0</span></div>
        <div className="kv"><span className="k">Proposed brand CN</span><input className="input sm" inputMode="decimal" value={proposed} onChange={(e) => setProposed(e.target.value)} /></div>
        <div className="kv total"><span>ShipDelight absorbs</span><span className="t-red">{inr(amount)}</span></div>
      </div>

      <div className="field"><div className="lbl">Exception type *</div>
        <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Choose a type</option>
          {EXCEPTION_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>
      <div className="field"><div className="lbl">Justification *</div><textarea className="textarea" style={{ minHeight: 96 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Why should SD pay the brand without a courier CN?" /></div>
      <div className="grid2">
        <div className="field"><div className="lbl">Approver *</div><select className="select" defaultValue="mgmt"><option value="mgmt">Management – L&amp;D owner</option></select></div>
        <div className="field"><div className="lbl">Needed by</div><input className="input" type="date" value={needed} min={isoDay()} onChange={(e) => setNeeded(e.target.value)} /></div>
      </div>
      <div className="callout purple">
        After approval the case returns to <b>Ready to release</b> with the approval reference and approver name. Accounts then issues the brand CN. If rejected, it closes as SD decision – no payout.
      </div>
    </Drawer>
  );
}
