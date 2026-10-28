"use client";
import { useRouter } from "next/navigation";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { postJson } from "./Drawer";
import { DateRange } from "./ListFilters";
import { inr } from "@/lib/format";

/** Dashboard header: period, courier and client filters. */
export function DashboardFilters({ couriers, clients, from, to, preset }: { couriers: string[]; clients: string[]; from: string; to: string; preset?: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const push = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    router.push(`${path}?${next.toString()}`);
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <DateRange bare align="right" from={from} to={to} preset={preset} onApply={(f, t) => push({ from: f ?? "all", to: t ?? "all" })} />
      <select className="select" style={{ width: 140 }} value={sp.get("courier") ?? ""} onChange={(e) => push({ courier: e.target.value || undefined })}>
        <option value="">All couriers</option>{couriers.map((c) => <option key={c}>{c}</option>)}
      </select>
      <select className="select" style={{ width: 130 }} value={sp.get("client") ?? ""} onChange={(e) => push({ client: e.target.value || undefined })}>
        <option value="">All clients</option>{clients.map((c) => <option key={c}>{c}</option>)}
      </select>
    </div>
  );
}

/** Left-hand filters of the approvals queue. */
export function QueueFilters() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const push = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    next.delete("sel");
    router.push(`${path}?${next.toString()}`);
  };
  const tab = sp.get("tab") ?? "approvals";
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
      {tab !== "decided" && (
        <>
          <label className="note-sm" style={{ display: "flex", alignItems: "center", gap: 8 }}>Type
            <select className="select" style={{ width: 180 }} value={sp.get("type") ?? ""} onChange={(e) => push({ type: e.target.value || undefined })}>
              <option value="">All</option>
              {tab === "escalations" ? (
                <><option value="STOP_CLAIM">Stop claim – SD absorbs</option><option value="NO_RESPONSE">No courier response</option></>
              ) : (
                <><option value="NO_COURIER_CN">Release without courier CN</option><option value="ABOVE_BRAND_LIABILITY">Above brand liability</option></>
              )}
            </select>
          </label>
          <label className="note-sm" style={{ display: "flex", alignItems: "center", gap: 8 }}>Sort
            <select className="select" style={{ width: 140 }} value={sp.get("sort") ?? ""} onChange={(e) => push({ sort: e.target.value || undefined })}>
              <option value="">Oldest first</option><option value="newest">Newest first</option><option value="amount">Highest amount</option>
            </select>
          </label>
        </>
      )}
    </div>
  );
}

/** Approve / Reject / Send back, with a comment. */
export function DecisionPanel({ id, amount, escalation }: { id: string; amount: number; escalation: boolean }) {
  const router = useRouter();
  const [choice, setChoice] = useState<"APPROVE" | "REJECT" | "SEND_BACK">("APPROVE");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    if (choice !== "APPROVE" && !note.trim()) return setError(choice === "REJECT" ? "Give a reason for rejecting." : "Say what information you need.");
    setBusy(true);
    try {
      await postJson(`/api/approvals/${id}`, { decision: choice, note: note.trim() || undefined });
      setNote("");
      router.push("/management/approvals?tab=" + (escalation ? "escalations" : "approvals"));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const foot =
    choice === "APPROVE" ? `Case moves to Accounts › Ready to release with approval ref and your name. SD absorbs ${inr(amount)}.`
    : choice === "REJECT" ? (escalation ? "OPS keeps chasing the courier; the escalation is closed." : "The request is closed. If it was a release without courier CN, the case closes as SD decision, no payout.")
    : "The requester is asked for more information; the case goes back to them.";
  return (
    <div>
      <div className="sect" style={{ fontSize: 16 }}>Your decision</div>
      <div className="choice">
        <button type="button" className={choice === "APPROVE" ? "on approve" : ""} onClick={() => setChoice("APPROVE")}>Approve</button>
        <button type="button" className={choice === "REJECT" ? "on reject" : ""} onClick={() => setChoice("REJECT")}>Reject</button>
        <button type="button" className={choice === "SEND_BACK" ? "on back" : ""} onClick={() => setChoice("SEND_BACK")}>Send back for info</button>
      </div>
      <div className="field" style={{ marginTop: 16 }}>
        <div className="lbl">{choice === "APPROVE" ? "Comment (optional)" : "Comment (required)"}</div>
        <textarea className="textarea" style={{ minHeight: 84 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible in the case timeline to OPS and Accounts" />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 14 }}>
        <span className="note-sm">{error ? <span className="errline">{error}</span> : foot}</span>
        <button type="button" disabled={busy} onClick={confirm} className={`btn ${choice === "APPROVE" ? "btn-green" : choice === "REJECT" ? "btn-primary" : "btn-purple"}`} style={choice === "REJECT" ? { background: "var(--red)", borderColor: "var(--red)" } : undefined}>
          {busy ? "Saving…" : choice === "APPROVE" ? "Confirm approval" : choice === "REJECT" ? "Confirm rejection" : "Send back"}
        </button>
      </div>
    </div>
  );
}
