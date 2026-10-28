"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Drawer, postJson } from "./Drawer";
import { FileDrop, type Uploaded } from "./FileDrop";
import type { CaseRow } from "@/lib/case-view";
import { inr } from "@/lib/format";

/** Accounts sends an OPS-marked case back because the courier CN entry needs fixing. */
export function ReturnDrawer({ c, onClose }: { c: CaseRow; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (!reason.trim()) return setError("Say what OPS needs to fix.");
    setBusy(true);
    try {
      await postJson(`/api/cases/${c.id}/return`, { reason: reason.trim() });
      onClose();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer title="Return to OPS" subtitle={`${c.awb} · ${c.client} · ${c.courier}`} onClose={onClose}
      footer={<>{error && <div className="msg errline">{error}</div>}<button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "Sending…" : "Return to OPS"}</button></>}>
      <div className="callout teal">The case leaves <b>Ready to release</b> and shows as returned in the OPS panel until OPS corrects the courier CN details and resubmits.</div>
      <div className="field"><div className="lbl">What does OPS need to fix? *</div><textarea className="textarea" style={{ minHeight: 110 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. CN amount on the PDF is ₹2,900, entered as ₹3,000" /></div>
    </Drawer>
  );
}

/** OPS corrected a returned case and sends it back to Accounts. */
export function ResubmitDrawer({ c, onClose }: { c: CaseRow; onClose: () => void }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    try {
      await postJson(`/api/cases/${c.id}/resubmit`, { note: note.trim() || undefined });
      onClose();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer title="Resubmit to Accounts" subtitle={`${c.awb} · ${c.client} · ${c.courier}`} onClose={onClose}
      footer={<>{error && <div className="msg errline">{error}</div>}<button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "Sending…" : "Resubmit"}</button></>}>
      <div className="banner red" style={{ margin: 0 }}><div><b>Returned by Accounts.</b> {c.chip.sub}</div></div>
      <div className="field"><div className="lbl">What did you correct?</div><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible in the case timeline" /></div>
    </Drawer>
  );
}

/** OPS marks a case by hand, with evidence. */
export function MarkCaseDrawer({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ awb: "", orderId: "", client: "", courier: "", type: "LOST", product: "", itemValue: "", clientLiability: "", courierLiability: "", markingReason: "" });
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function submit() {
    setError(null);
    if (!f.awb.trim() || !f.client.trim() || !f.courier.trim()) return setError("AWB, client and courier are required.");
    if (!(Number(f.itemValue) >= 0) || f.itemValue === "") return setError("Enter the item value.");
    if (files.length === 0) return setError("Attach evidence (hub confirmation, photos, scan history).");
    setBusy(true);
    try {
      await postJson("/api/cases", {
        awb: f.awb.trim(), orderId: f.orderId.trim() || undefined, client: f.client.trim(), courier: f.courier.trim(), type: f.type,
        product: f.product.trim() || undefined, markingReason: f.markingReason.trim() || undefined,
        itemValue: Number(f.itemValue), clientLiability: Number(f.clientLiability || f.itemValue), courierLiability: Number(f.courierLiability || f.itemValue),
        pickedUpAt: new Date().toISOString(), evidence: files,
      });
      onClose();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer title="Mark a case" subtitle="Manually mark a shipment Lost or Damaged. You become the case owner." onClose={onClose}
      pinned={<FileDrop files={files} onChange={setFiles} required title="Evidence" help="e.g. hub confirmation, damage photos, scan history" />}
      footer={<>{error && <div className="msg errline">{error}</div>}<button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Mark case"}</button></>}>
      <div className="grid2">
        <div className="field"><div className="lbl">AWB *</div><input className="input mono" value={f.awb} onChange={set("awb")} /></div>
        <div className="field"><div className="lbl">Order no.</div><input className="input" value={f.orderId} onChange={set("orderId")} /></div>
        <div className="field"><div className="lbl">Client (brand) *</div><input className="input" value={f.client} onChange={set("client")} /></div>
        <div className="field"><div className="lbl">Courier *</div><input className="input" value={f.courier} onChange={set("courier")} /></div>
        <div className="field"><div className="lbl">Type *</div><select className="select" value={f.type} onChange={set("type")}><option value="LOST">Lost</option><option value="DAMAGED">Damaged</option></select></div>
        <div className="field"><div className="lbl">Product</div><input className="input" value={f.product} onChange={set("product")} /></div>
        <div className="field"><div className="lbl">Item value (excl. GST) *</div><input className="input" inputMode="decimal" value={f.itemValue} onChange={set("itemValue")} /></div>
        <div className="field"><div className="lbl">Client liability</div><input className="input" inputMode="decimal" value={f.clientLiability} onChange={set("clientLiability")} placeholder={f.itemValue ? inr(Number(f.itemValue)) : "defaults to item value"} /></div>
        <div className="field"><div className="lbl">Courier liability</div><input className="input" inputMode="decimal" value={f.courierLiability} onChange={set("courierLiability")} placeholder={f.itemValue ? inr(Number(f.itemValue)) : "defaults to item value"} /></div>
      </div>
      <div className="field"><div className="lbl">Marking reason</div><textarea className="textarea" value={f.markingReason} onChange={set("markingReason")} placeholder="e.g. No scan for 4 days; hub confirmed shipment untraceable" /></div>
    </Drawer>
  );
}
