"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ExceptionDrawer } from "./ExceptionDrawer";
import { ReleaseDrawer } from "./ReleaseDrawer";
import { ResubmitDrawer, ReturnDrawer } from "./SmallDrawers";
import { UpdateStatusDrawer } from "./UpdateStatusDrawer";
import { Chip, LockIcon, SourcePill, TicketChip, TypeTag } from "./ui";
import { factsOfRow, type CaseRow } from "@/lib/case-view";
import { dayShort, inr } from "@/lib/format";
import { allowedDispositions } from "@/lib/rules";
import type { Role } from "@/lib/types";

export type TableMode = "ops" | "ready" | "await" | "approval" | "released";
type DrawerState =
  | { kind: "update"; cases: CaseRow[] }
  | { kind: "release"; cases: CaseRow[] }
  | { kind: "exception"; c: CaseRow }
  | { kind: "return"; c: CaseRow }
  | { kind: "resubmit"; c: CaseRow }
  | null;

const who = (name: string, role: string) => `${name}${role === "OPS" ? " (OPS)" : role === "ACCOUNTS" ? " (Accounts)" : ""}`;
const ownerLabel = (c: CaseRow) => (c.source === "API" ? "Courier API" : who(c.markedBy, c.markedByRole));

const HEADERS: Record<TableMode, string[]> = {
  ops: ["AWB", "Order", "Client", "Courier", "Source", "Status · marked", "Item value / Client liab. / Courier liab.", "Ticket status", "Action"],
  ready: ["AWB", "Order", "Client", "Courier", "Source", "Status · marked", "Item / Brand liab. / Courier CN", "Courier CN", "Ticket status", "Action"],
  await: ["AWB", "Order", "Client", "Courier", "Source", "Status · marked", "Item / Brand liab. / Courier liab.", "Courier CN · last action", "Ticket status", "Action"],
  approval: ["AWB", "Order", "Client", "Courier", "Source", "Status · marked", "Item / Brand liab. / Courier CN", "Waiting for management", "Ticket status", "Action"],
  released: ["AWB", "Order", "Client", "Courier", "Source", "Status · marked", "Brand CN", "SD gap", "Courier settlement", "Action"],
};

export function CaseTable({ rows, mode, role }: { rows: CaseRow[]; mode: TableMode; role: string }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const view = mode === "ops" ? "ops" : "accounts";

  const selectable = (c: CaseRow) => {
    if (mode === "ready") return !c.clientCn;
    if (mode === "ops" || mode === "await") return allowedDispositions(role as Role, factsOfRow(c)).length > 0;
    return false;
  };
  const canSelectAny = rows.some(selectable);
  const picked = useMemo(() => rows.filter((r) => sel.has(r.id)), [rows, sel]);
  const mixed = mode === "ready" ? new Set(picked.map((p) => p.client)).size > 1 : new Set(picked.map((p) => p.courier)).size > 1;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = canSelectAny && rows.filter(selectable).every((r) => sel.has(r.id));

  const update = (cases: CaseRow[]) => setDrawer({ kind: "update", cases });
  const cols = HEADERS[mode].length + (canSelectAny ? 1 : 0);

  const exceptionOk = (c: CaseRow) => c.status === "COURIER_REJECTED" || c.status === "ESCALATED" || c.status === "FOLLOW_UP" || c.ageDays > 15;

  const cell = (c: CaseRow) => {
    const marked = (
      <td>
        <TypeTag type={c.type} />
        <div className={`sub${c.ageDays > 30 ? " red" : ""}`}>{dayShort(c.markedAt)} · {c.ageDays} d</div>
        <div className="sub">by {ownerLabel(c)}</div>
      </td>
    );
    const common = (
      <>
        <td className="nw"><Link href={`/cases/${c.id}`} className="strong" style={{ textDecoration: "none" }}>{c.awb}</Link></td>
        <td className="nw">{c.orderId ?? "—"}</td>
        <td>
          {c.client}
          {view === "accounts" && c.duesAmount > 0 && c.duesAgeDays >= 30 && <div className="sub orange">Dues {inr(c.duesAmount)} &gt; 30 d</div>}
        </td>
        <td>{c.courier}</td>
        <td><SourcePill source={c.source} view={view} /></td>
        {marked}
      </>
    );
    if (mode === "ops") {
      const lowCourier = c.courierLiability < c.clientLiability;
      return (
        <>
          {common}
          <td><div className="mini"><span>Item</span><span>{inr(c.itemValue)}</span><span>Client</span><span>{inr(c.clientLiability)}</span><span>Courier</span><span className={lowCourier ? "t-orange strong" : ""}>{inr(c.courierLiability)}</span></div></td>
          <td><TicketChip chip={c.chip} /></td>
          <td>
            <div className="actions">
              <span><Link className="link" href={`/cases/${c.id}`}>View</Link>
                {c.source === "MANUAL" && c.isOpen && !c.clientCn && !c.returnedToOps && <> <span className="muted">·</span> <button type="button" className="link" onClick={() => update([c])}>Update</button></>}
              </span>
              {c.returnedToOps && <button type="button" className="link" onClick={() => setDrawer({ kind: "resubmit", c })}>Resubmit</button>}
            </div>
          </td>
        </>
      );
    }
    if (mode === "ready") {
      const cn = c.courierCn;
      const partSettled = cn && cn.settlement === "PARTIAL";
      return (
        <>
          {common}
          <td><div className="mini"><span>Item</span><span>{inr(c.itemValue)}</span><span>Brand</span><span className="strong">{inr(c.clientLiability)}</span><span>Courier CN</span><span>{inr(c.courierCnAmount)}</span>{c.sdGap > 0 && <><span>SD gap</span><span className="t-orange strong">{inr(c.sdGap)}</span></>}</div></td>
          <td>
            {cn ? (
              <>
                <div className="mono" style={{ fontSize: 12 }}>{cn.number} · {dayShort(cn.date)}</div>
                <div className="sub">by {who(cn.by, cn.byRole)}</div>
                <div style={{ marginTop: 5 }}>
                  {cn.settlement === "SETTLED" ? <Chip tone="green">Courier settled</Chip>
                    : partSettled ? <Chip tone="teal">Courier part-settled {inr(cn.settled)}</Chip>
                    : <Chip tone="amber">Courier settlement pending</Chip>}
                </div>
              </>
            ) : (
              <><Chip tone="purple">Approved without CN</Chip><div className="sub">SD absorbs the full amount</div></>
            )}
          </td>
          <td><TicketChip chip={c.chip} /></td>
          <td>
            <div className="actions">
              <Link className="link" href={`/cases/${c.id}`}>View</Link>
              <button type="button" className="link" onClick={() => setDrawer({ kind: "release", cases: [c] })}>Release CN</button>
              {c.source === "MANUAL" && <button type="button" className="link-muted" style={{ background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer" }} onClick={() => setDrawer({ kind: "return", c })}>Return to OPS</button>}
            </div>
          </td>
        </>
      );
    }
    if (mode === "await") {
      const gap = Math.max(0, c.clientLiability - c.courierLiability);
      const allowed = allowedDispositions(role as Role, factsOfRow(c));
      const act = c.lastAction;
      return (
        <>
          {common}
          <td><div className="mini"><span>Item</span><span>{inr(c.itemValue)}</span><span>Brand</span><span className="strong">{inr(c.clientLiability)}</span><span>Courier</span><span>{inr(c.courierLiability)}</span>{gap > 0 && <><span>SD gap</span><span className="t-orange strong">{inr(gap)}</span></>}</div></td>
          <td>
            <Chip tone="amber">{c.returnedToOps ? "Returned to OPS" : "Courier CN pending"}</Chip>
            <div className="sub" style={{ color: "var(--ink)" }}>{act ? `${act.label} · ${dayShort(act.at)}` : "No action yet"}</div>
            {act && <div className="sub">by {who(act.by, act.role)}</div>}
          </td>
          <td><TicketChip chip={c.chip} /></td>
          <td>
            <div className="actions">
              <Link className="link" href={`/cases/${c.id}`}>View</Link>
              {allowed.length > 0 && <button type="button" className="link" onClick={() => update([c])}>{c.source === "API" ? "Update" : "Follow-up"}</button>}
              {exceptionOk(c) && <button type="button" className="link" onClick={() => setDrawer({ kind: "exception", c })}>Request exception</button>}
              <span className="locked"><LockIcon /> Release locked</span>
            </div>
          </td>
        </>
      );
    }
    if (mode === "approval") {
      const ap = c.approval;
      return (
        <>
          {common}
          <td><div className="mini"><span>Item</span><span>{inr(c.itemValue)}</span><span>Brand</span><span className="strong">{inr(c.clientLiability)}</span><span>Courier CN</span><span>{inr(c.courierCnAmount)}</span></div></td>
          <td>
            {ap ? (<><Chip tone="purple">{ap.type ?? "Approval"}</Chip><div className="strong" style={{ marginTop: 5 }}>{inr(ap.amount)}</div><div className="sub">{dayShort(ap.since)} · by {ap.by}</div></>) : "—"}
          </td>
          <td><TicketChip chip={c.chip} /></td>
          <td><div className="actions"><Link className="link" href={`/cases/${c.id}`}>View</Link></div></td>
        </>
      );
    }
    // released
    const cn = c.courierCn;
    return (
      <>
        {common}
        <td>
          {c.clientCn ? (<><div className="mono" style={{ fontSize: 12 }}>{c.clientCn.number}</div><div className="sub">{c.clientCn.date ? dayShort(c.clientCn.date) : ""} · {inr(c.clientCn.amount)}</div></>) : <TicketChip chip={c.chip} />}
        </td>
        <td className={c.sdGap > 0 ? "t-orange strong" : ""}>{inr(c.sdGap)}</td>
        <td>
          {cn ? (cn.settlement === "SETTLED" ? <Chip tone="green">Courier settled</Chip> : cn.settlement === "PARTIAL" ? <Chip tone="teal">Part-settled {inr(cn.settled)}</Chip> : <Chip tone="amber">Settlement pending</Chip>)
            : <Chip tone="grey">No courier CN</Chip>}
        </td>
        <td><div className="actions"><Link className="link" href={`/cases/${c.id}`}>View</Link></div></td>
      </>
    );
  };

  const bulkLabel = mode === "ready" ? "Release CN to brand" : "Update status";
  return (
    <>
      {picked.length > 0 && (
        <div className="bulkbar">
          <span><b>{picked.length}</b> selected</span>
          {mixed && <span className="t-orange">{mode === "ready" ? "Select cases of one client to release one brand CN." : "Select cases of one courier to update together."}</span>}
          <button type="button" className="btn btn-sm btn-primary" style={{ color: "#fff" }} disabled={mixed}
            onClick={() => (mode === "ready" ? setDrawer({ kind: "release", cases: picked }) : update(picked))}>{bulkLabel} ({picked.length})</button>
          <button type="button" className="link" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              {canSelectAny && <th style={{ width: 36 }}><input className="cb" type="checkbox" checked={allOn} aria-label="Select all" onChange={() => setSel(allOn ? new Set() : new Set(rows.filter(selectable).map((r) => r.id)))} /></th>}
              {HEADERS[mode].map((h) => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={cols} className="empty">No cases match these filters.</td></tr>}
            {rows.map((c) => (
              <tr key={c.id} className={sel.has(c.id) ? "row-sel" : ""}>
                {canSelectAny && <td>{selectable(c) ? <input className="cb" type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.awb}`} /> : null}</td>}
                {cell(c)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {drawer?.kind === "update" && <UpdateStatusDrawer cases={drawer.cases} role={role} onClose={() => { setDrawer(null); setSel(new Set()); }} />}
      {drawer?.kind === "release" && <ReleaseDrawer cases={drawer.cases} onClose={() => { setDrawer(null); setSel(new Set()); }} />}
      {drawer?.kind === "exception" && <ExceptionDrawer c={drawer.c} onClose={() => setDrawer(null)} />}
      {drawer?.kind === "return" && <ReturnDrawer c={drawer.c} onClose={() => setDrawer(null)} />}
      {drawer?.kind === "resubmit" && <ResubmitDrawer c={drawer.c} onClose={() => setDrawer(null)} />}
    </>
  );
}
