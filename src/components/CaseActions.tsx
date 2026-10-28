"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "./Drawer";
import { ExceptionDrawer } from "./ExceptionDrawer";
import { ReleaseDrawer } from "./ReleaseDrawer";
import { ResubmitDrawer, ReturnDrawer } from "./SmallDrawers";
import { UpdateStatusDrawer } from "./UpdateStatusDrawer";
import { LockIcon } from "./ui";
import { factsOfRow, type CaseRow } from "@/lib/case-view";
import { allowedDispositions } from "@/lib/rules";
import type { Role } from "@/lib/types";

type D = null | "update" | "escalate" | "release" | "return" | "exception" | "resubmit";

/** Buttons in the case header. Each role sees only the actions it owns. */
export function CaseActions({ row, role, kind }: { row: CaseRow; role: string; kind: "ops" | "accounts" | "view" }) {
  const [d, setD] = useState<D>(null);
  const allowed = allowedDispositions(role as Role, factsOfRow(row));
  const open = row.isOpen && !row.clientCn;
  const ready = open && !row.returnedToOps && row.status !== "PENDING_APPROVAL" && (row.courierCnAmount > 0 || row.releaseApproved);
  const exceptionOk = open && row.courierCnAmount <= 0 && !row.releaseApproved && row.status !== "PENDING_APPROVAL";

  return (
    <>
      <div className="page-actions">
        {kind === "ops" && (allowed.length > 0 || (open && row.returnedToOps)) && (
          <>
            {row.returnedToOps && <button type="button" className="btn btn-primary" onClick={() => setD("resubmit")}>Resubmit to Accounts</button>}
            {allowed.includes("ESCALATE") && <button type="button" className="btn" onClick={() => setD("escalate")}>Escalate</button>}
            {allowed.some((a) => a !== "ESCALATE") && !row.returnedToOps && <button type="button" className="btn btn-primary" onClick={() => setD("update")}>Update status</button>}
          </>
        )}
        {kind === "accounts" && open && (
          <>
            {ready && row.source === "MANUAL" && <button type="button" className="btn" onClick={() => setD("return")}>Return to OPS</button>}
            {!ready && allowed.length > 0 && <button type="button" className="btn btn-teal" onClick={() => setD("update")}>{row.source === "API" ? "Update status" : "Add follow-up"}</button>}
            {exceptionOk && row.ageDays > 0 && <button type="button" className="btn" onClick={() => setD("exception")}>Request exception</button>}
            {ready ? (
              <button type="button" className="btn btn-primary" onClick={() => setD("release")}>Release CN to brand</button>
            ) : row.status !== "PENDING_APPROVAL" ? (
              <button type="button" className="btn btn-locked" disabled><LockIcon /> Release CN to brand</button>
            ) : null}
          </>
        )}
      </div>
      {(d === "update" || d === "escalate") && <UpdateStatusDrawer cases={[row]} role={role} mode={d} onClose={() => setD(null)} />}
      {d === "release" && <ReleaseDrawer cases={[row]} onClose={() => setD(null)} />}
      {d === "return" && <ReturnDrawer c={row} onClose={() => setD(null)} />}
      {d === "exception" && <ExceptionDrawer c={row} onClose={() => setD(null)} />}
      {d === "resubmit" && <ResubmitDrawer c={row} onClose={() => setD(null)} />}
    </>
  );
}

/** "Add internal note" box under the timeline. */
export function NoteForm({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/cases/${caseId}/comments`, { message: text.trim() });
      setText("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16, marginTop: 8 }}>
      <div className="strong" style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Add internal note</div>
      <textarea className="textarea" style={{ minHeight: 76 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Visible to OPS, Accounts and Management" />
      {error && <div className="errline" style={{ marginTop: 6 }}>{error}</div>}
      <div style={{ textAlign: "right", marginTop: 10 }}>
        <button type="button" className="btn" disabled={busy || !text.trim()} onClick={add}>{busy ? "Adding…" : "Add note"}</button>
      </div>
    </div>
  );
}
