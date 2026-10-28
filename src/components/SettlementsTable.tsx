"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Drawer, postJson } from "./Drawer";
import { FileDrop, type Uploaded } from "./FileDrop";
import { DateRange } from "./ListFilters";
import { Chip } from "./ui";
import { dayShort, inr, isoDay, monthName } from "@/lib/format";
import { round2 } from "@/lib/rules";
import type { SettlementRow } from "@/lib/reports";

type Mode = "FREIGHT_ADJUSTMENT" | "BANK_TRANSFER";

/** Filter row: search CN / UTR / freight bill, courier, mode, CN date. */
export function SettlementFilters({ couriers }: { couriers: string[] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const get = (k: string) => sp.get(k) ?? "";
  const [q, setQ] = useState(get("q"));
  useEffect(() => setQ(get("q")), [sp]); // eslint-disable-line react-hooks/exhaustive-deps
  const push = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    router.push(`${path}?${next.toString()}`);
  };
  return (
    <div className="filters">
      <div className="field grow">
        <div className="lbl">Search courier CN / UTR / freight bill no.</div>
        <input className="input" placeholder="e.g. DLV/CN/04418" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && push({ q: q.trim() || undefined })} onBlur={() => q.trim() !== get("q") && push({ q: q.trim() || undefined })} />
      </div>
      <div className="field" style={{ width: 150 }}>
        <div className="lbl">Courier</div>
        <select className="select" value={get("courier")} onChange={(e) => push({ courier: e.target.value || undefined })}>
          <option value="">All couriers</option>
          {couriers.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div className="field" style={{ width: 150 }}>
        <div className="lbl">Mode</div>
        <select className="select" value={get("mode")} onChange={(e) => push({ mode: e.target.value || undefined })}>
          <option value="">All</option><option value="FREIGHT_ADJUSTMENT">Freight bill</option><option value="BANK_TRANSFER">Bank transfer</option>
        </select>
      </div>
      <DateRange label="CN date" align="right" from={get("from") || undefined} to={get("to") || undefined} onApply={(f, t) => push({ from: f, to: t })} />
    </div>
  );
}

export function SettlementsTable({ rows, options, settled }: { rows: SettlementRow[]; options: SettlementRow[]; settled: boolean }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string[] | null>(null);
  const picked = rows.filter((r) => sel.has(r.id));
  const mixed = new Set(picked.map((p) => p.courier)).size > 1;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const first = (r: SettlementRow) => `/cases/${r.lines[0]?.caseId}`;

  return (
    <>
      {picked.length > 0 && (
        <div className="bulkbar">
          <span><b>{picked.length}</b> selected</span>
          {mixed && <span className="t-orange">Select CNs of one courier to record together.</span>}
          <button type="button" className="btn btn-sm btn-primary" style={{ color: "#fff" }} disabled={mixed} onClick={() => setOpen(picked.map((p) => p.id))}>Record settlement ({picked.length})</button>
          <button type="button" className="link" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              {!settled && <th style={{ width: 36 }}><input className="cb" type="checkbox" checked={allOn} aria-label="Select all" onChange={() => setSel(allOn ? new Set() : new Set(rows.map((r) => r.id)))} /></th>}
              <th>Courier CN</th><th>Courier</th><th>CN date</th><th className="num">AWBs</th><th className="num">CN amount</th><th className="num">Settled</th><th className="num">Balance</th><th>Settlement</th><th>Brand CN</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={11} className="empty">Nothing here.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className={sel.has(r.id) ? "row-sel" : ""}>
                {!settled && <td className="mid"><input className="cb" type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.cnNumber}`} /></td>}
                <td><div className="mono strong">{r.cnNumber}</div><div className="sub">entered by {r.enteredBy}{r.enteredByRole === "OPS" ? " (OPS)" : " (Accounts)"}</div></td>
                <td>{r.courier}</td>
                <td>{dayShort(r.cnDate)}<div className={`sub${!settled && r.unsettledDays > 30 ? " red" : ""}`}>{settled ? "" : `${r.unsettledDays} d unsettled`}</div></td>
                <td className="num"><Link className="link" href={first(r)}>{r.awbs}</Link></td>
                <td className="num">{inr(r.total)}</td>
                <td className="num t-green">{inr(r.settled)}</td>
                <td className="num strong">{inr(r.balance)}</td>
                <td>
                  {r.state === "SETTLED" ? <Chip tone="green">Settled</Chip> : r.state === "PARTIAL" ? <Chip tone="teal">Partly settled</Chip> : <Chip tone="amber">Pending</Chip>}
                  {r.last ? (
                    <>
                      <div className="sub">{r.last.mode === "BANK_TRANSFER" ? `Bank transfer · ${dayShort(r.last.on)}` : `Freight bill adj. · ${r.last.month ?? ""}`}</div>
                      <div className="sub mono">{r.last.utr ?? r.last.ref}</div>
                    </>
                  ) : (
                    <>
                      <div className="sub">Expected: {r.expected}</div>
                      {r.chased > 0 && <div className="sub mono">Chased {r.chased} time{r.chased === 1 ? "" : "s"}</div>}
                    </>
                  )}
                </td>
                <td className="mid">{r.released} of {r.awbs} released</td>
                <td>
                  <div className="actions">
                    <Link className="link" href={first(r)}>View CN</Link>
                    {!settled && <button type="button" className="link" onClick={() => setOpen([r.id])}>Record settlement</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <SettlementDrawer all={options} preselected={open} onClose={() => { setOpen(null); setSel(new Set()); }} />}
    </>
  );
}

/** "Record settlement" button for the page header: opens the panel with nothing preselected. */
export function RecordSettlementButton({ options }: { options: SettlementRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary" disabled={options.length === 0} onClick={() => setOpen(true)}>Record settlement</button>
      {open && <SettlementDrawer all={options} preselected={[]} onClose={() => setOpen(false)} />}
    </>
  );
}

function SettlementDrawer({ all, preselected, onClose }: { all: SettlementRow[]; preselected: string[]; onClose: () => void }) {
  const router = useRouter();
  const startCourier = all.find((r) => r.id === preselected[0])?.courier ?? all[0]?.courier ?? "";
  const [courier, setCourier] = useState(startCourier);
  const [mode, setMode] = useState<Mode>(all.find((r) => r.id === preselected[0])?.expected === "bank transfer" ? "BANK_TRANSFER" : "FREIGHT_ADJUSTMENT");
  const [picks, setPicks] = useState<{ id: string; apply: string }[]>(() => {
    const ids = preselected.length ? preselected : all[0] ? [all[0].id] : [];
    return ids.map((id) => ({ id, apply: String(all.find((r) => r.id === id)?.balance ?? "") }));
  });
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [billNo, setBillNo] = useState("");
  const [utr, setUtr] = useState("");
  const [on, setOn] = useState(isoDay());
  const [amountEdit, setAmountEdit] = useState<string | null>(null);
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(all.map((r) => [r.id, r])), [all]);
  const couriers = [...new Set(all.map((r) => r.courier))];
  const spare = all.filter((r) => r.courier === courier && !picks.some((p) => p.id === r.id));
  const sum = round2(picks.reduce((s, p) => s + (Number(p.apply) || 0), 0));
  const amount = amountEdit !== null ? Number(amountEdit) : sum;
  const cases = picks.reduce((s, p) => s + (byId.get(p.id)?.awbs ?? 0), 0);

  const changeCourier = (c: string) => {
    setCourier(c);
    const f = all.find((r) => r.courier === c);
    setPicks(f ? [{ id: f.id, apply: String(f.balance) }] : []);
    setAmountEdit(null);
  };

  async function submit() {
    setError(null);
    if (picks.length === 0) return setError("Choose at least one courier CN.");
    if (picks.some((p) => !(Number(p.apply) > 0) || Number(p.apply) > (byId.get(p.id)?.balance ?? 0))) return setError("Each amount must be above zero and within the CN balance.");
    if (mode === "FREIGHT_ADJUSTMENT" && (!month || !billNo.trim())) return setError("Enter the freight bill month and number.");
    if (mode === "BANK_TRANSFER" && !utr.trim()) return setError("Enter the UTR.");
    if (round2(amount) !== sum) return setError(`The amount (${inr(amount)}) must match what you apply to the CNs (${inr(sum)}).`);
    if (files.length === 0) return setError("Attach the proof.");
    setBusy(true);
    try {
      await postJson("/api/settlements", {
        mode, amount, settledOn: on,
        freightMonth: mode === "FREIGHT_ADJUSTMENT" ? month : undefined,
        freightBillNo: mode === "FREIGHT_ADJUSTMENT" ? billNo.trim() : undefined,
        utr: mode === "BANK_TRANSFER" ? utr.trim() : undefined,
        items: picks.map((p) => ({ courierCnId: p.id, amount: Number(p.apply) })),
        proof: files, remarks: remarks.trim() || undefined,
      });
      onClose();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Drawer title="Record courier settlement" subtitle={`${courier} · ${picks.length} confirmed CN${picks.length === 1 ? "" : "s"} selected`} onClose={onClose}
      pinned={<><FileDrop files={files} onChange={setFiles} required title="Proof" max={1} help={mode === "FREIGHT_ADJUSTMENT" ? "Courier freight bill showing the CN deduction" : "Bank advice or statement line"} /><div className="field"><div className="sect" style={{ margin: "0 0 8px" }}>Remarks</div><textarea className="textarea" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Visible on each CN and its cases" /></div></>}
      footer={<>{error && <div className="msg errline">{error}</div>}<button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "Saving…" : `Record ${inr(sum)} settlement`}</button></>}>
      {couriers.length > 1 && (
        <div className="field"><div className="lbl">Courier</div><select className="select" value={courier} onChange={(e) => changeCourier(e.target.value)}>{couriers.map((c) => <option key={c}>{c}</option>)}</select></div>
      )}
      <div>
        <div className="sect">How did the courier settle?</div>
        <div className="grid2">
          <button type="button" className={`radio-card${mode === "FREIGHT_ADJUSTMENT" ? " on" : ""}`} onClick={() => setMode("FREIGHT_ADJUSTMENT")}><span className="r" /><span><div className="t">Freight bill adjustment</div><div className="d">Deducted from the courier&apos;s monthly freight bill</div></span></button>
          <button type="button" className={`radio-card${mode === "BANK_TRANSFER" ? " on" : ""}`} onClick={() => setMode("BANK_TRANSFER")}><span className="r" /><span><div className="t">Bank transfer</div><div className="d">Courier paid SD directly</div></span></button>
        </div>
      </div>

      <div>
        <div className="sect">{mode === "FREIGHT_ADJUSTMENT" ? "Freight bill adjustment details" : "Bank transfer details"}</div>
        <div className="grid2">
          {mode === "FREIGHT_ADJUSTMENT" ? (
            <>
              <div className="field"><div className="lbl">Freight bill month *</div><input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
              <div className="field"><div className="lbl">Courier freight bill no. *</div><input className="input mono" value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="e.g. DLV/FB/2610-131" /></div>
            </>
          ) : (
            <div className="field" style={{ gridColumn: "span 2" }}><div className="lbl">UTR *</div><input className="input mono" value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="e.g. ICIC2610040091" /></div>
          )}
          <div className="field"><div className="lbl">{mode === "FREIGHT_ADJUSTMENT" ? "Amount adjusted *" : "Amount received *"}</div><input className="input" inputMode="decimal" value={amountEdit ?? String(sum)} onChange={(e) => setAmountEdit(e.target.value)} /></div>
          <div className="field"><div className="lbl">{mode === "FREIGHT_ADJUSTMENT" ? "Adjusted on *" : "Received on *"}</div><input className="input" type="date" max={isoDay()} value={on} onChange={(e) => setOn(e.target.value)} /></div>
        </div>
        {mode === "FREIGHT_ADJUSTMENT" && month && <p className="note-sm" style={{ marginTop: 8 }}>Applied against the {monthName(month)} freight bill.</p>}
      </div>

      <div>
        <div className="sect">Apply to CNs</div>
        <div className="mini-tbl">
          <table>
            <thead><tr><th>Courier CN</th><th className="num">CN amount</th><th className="num">Balance</th><th className="num">Apply now</th><th>After</th></tr></thead>
            <tbody>
              {picks.map((p) => {
                const r = byId.get(p.id);
                if (!r) return null;
                const v = Number(p.apply) || 0;
                return (
                  <tr key={p.id}>
                    <td><div className="mono">{r.cnNumber}</div><div className="lbl2">{dayShort(r.cnDate)} · {r.awbs} AWB{r.awbs === 1 ? "" : "s"}</div></td>
                    <td className="num">{inr(r.total)}</td>
                    <td className="num">{inr(r.balance)}</td>
                    <td className="num"><input className="input sm" inputMode="decimal" value={p.apply} onChange={(e) => setPicks(picks.map((x) => (x.id === p.id ? { ...x, apply: e.target.value } : x)))} /></td>
                    <td>{v > r.balance ? <span className="res-bad">Over balance</span> : round2(r.balance - v) === 0 ? <span className="res-ok">Settled</span> : <span className="res-warn">Partly settled</span>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr className="totrow"><td>Total</td><td className="num">{inr(round2(picks.reduce((s, p) => s + (byId.get(p.id)?.total ?? 0), 0)))}</td><td className="num">{inr(round2(picks.reduce((s, p) => s + (byId.get(p.id)?.balance ?? 0), 0)))}</td><td className="num">{inr(sum)}</td><td>{round2(amount) === sum ? <span className="res-ok">Matches amount</span> : <span className="res-bad">Differs from amount</span>}</td></tr></tfoot>
          </table>
        </div>
        {spare.length > 0 && (
          <select className="select" style={{ marginTop: 10, borderStyle: "dashed", color: "var(--teal)", fontWeight: 500 }} value="" onChange={(e) => { const r = byId.get(e.target.value); if (r) { setPicks([...picks, { id: r.id, apply: String(r.balance) }]); setAmountEdit(null); } }}>
            <option value="">+ Add another {courier} CN</option>
            {spare.map((r) => <option key={r.id} value={r.id}>{r.cnNumber} · balance {inr(r.balance)}</option>)}
          </select>
        )}
        <p className="note-sm" style={{ marginTop: 8 }}>Apply less than the balance to record a part-settlement; the rest stays open on the CN.</p>
      </div>

      <div className="callout teal">On save, {picks.length === 1 ? "this CN and its" : `these ${picks.length} CNs and their`} {cases} case{cases === 1 ? "" : "s"} show the courier settlement with the {mode === "FREIGHT_ADJUSTMENT" ? "freight bill" : "UTR"} reference, recorded by you.</div>
    </Drawer>
  );
}
