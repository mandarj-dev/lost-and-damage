"use client";
// Bulk update via Excel (Figma OPS "Bulk update via Excel" + Card "Review validation"), wired to:
//   GET  /dispute-operations/import/template?action=…   (XLSX download, bearer token)
//   POST /dispute-operations/import  multipart {action, dry_run, file, zip_file?}
//   GET  /dispute-operations/import/logs?page=…
import { Fragment, useRef, useState } from "react";
import { api, IMPORT_ACTIONS, type ImportAction, type ImportLog, type ImportLogErrors, type ImportSummary } from "@/lib/api";
import { RoleGate, Status, useApi } from "./ApiKit";
import { Head, Pager, dayFull, nf } from "./FigmaKit";

const LABEL: Record<ImportAction, string> = {
  CLAIM_SENT: "Claim raised to courier", FOLLOW_UP: "Follow-up sent", CN_RECEIVED: "CN received", CN_REJECTED: "Courier rejected (CN rejected)",
  FOUND: "Found / delivered", ESCALATE: "Escalate to management", MARK: "Mark shipment lost / damaged",
};
// Template headers from the backend's build_import_columns (shown as chips; the downloaded template is the source of truth).
const COLS: Record<string, string[]> = {
  MARK: ["AWB *", "Status *", "Manual Entry", "Remarks", "User Id"],
  CN_RECEIVED: ["AWB *", "CN No. *", "CN Date *", "CN Amount *", "CN File *", "Short Reason"],
  CN_REJECTED: ["AWB *", "Reason *"],
};
const colsFor = (a: ImportAction) => COLS[a] ?? ["AWB *", "Remarks"];
const NOTE: Record<string, string> = {
  MARK: "Bulk mark of new Lost / Damaged cases from an XLSX or the InstaLogix CSV export. Orders that already have an open case are skipped.",
  CN_RECEIVED: "Repeat the same CN No. on several rows for a consolidated CN. Upload the CN files as one ZIP; the CN File column must match a file name in the ZIP.",
};
const fileKey = (f: File | null) => (f ? `${f.name}|${f.size}|${f.lastModified}` : "");
const Step = ({ n, t, right, children }: { n: number; t: string; right?: React.ReactNode; children: React.ReactNode }) => (
  <div className="card card-pad" style={{ marginBottom: 16 }}>
    <h2 style={{ display: "flex", gap: 10, alignItems: "center" }}><span style={{ width: 26, height: 26, borderRadius: 13, background: "var(--red-soft)", color: "var(--red)", display: "grid", placeItems: "center", fontSize: 13 }}>{n}</span>{t}<span style={{ marginLeft: "auto", fontWeight: 400 }}>{right}</span></h2>
    {children}
  </div>
);
const Tile = ({ l, v, tone }: { l: string; v: React.ReactNode; tone?: string }) => (
  <div className="kpi" style={{ minHeight: 84 }}><div className="k-label">{l}</div><div className={`k-value${tone ? ` t-${tone}` : ""}`} style={{ marginTop: 10 }}>{v}</div></div>
);
const STATUS_CHIP: Record<string, string> = { DONE: "green", FAILED: "red", PROCESSING: "amber" };

export function LiveBulk({ panel }: { panel: "Ops" | "Accounts" }) {
  const [action, setAction] = useState<ImportAction>("CN_RECEIVED");
  const [file, setFile] = useState<File | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [busy, setBusy] = useState<null | "template" | "dry" | "apply">(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dry, setDry] = useState<{ key: string; s: ImportSummary } | null>(null);
  const [applied, setApplied] = useState<ImportSummary | null>(null);
  const [page, setPage] = useState(1);
  const [openLog, setOpenLog] = useState<string | null>(null);
  const [logErrors, setLogErrors] = useState<{ id: string; loading: boolean; error: string | null; data: ImportLogErrors | null } | null>(null);
  const toggleLog = async (id: string) => {
    if (openLog === id) { setOpenLog(null); return; }
    setOpenLog(id);
    setLogErrors({ id, loading: true, error: null, data: null });
    try {
      const data = await api.importLogErrors(id);
      setLogErrors((cur) => (cur?.id === id ? { id, loading: false, error: null, data } : cur));
    } catch (e) {
      setLogErrors((cur) => (cur?.id === id ? { id, loading: false, error: e instanceof Error ? e.message : "Could not load errors", data: null } : cur));
    }
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const logs = useApi(() => api.importLogs(page), [page]);

  const needsZip = action === "CN_RECEIVED";
  const showZip = action !== "MARK";
  const runKey = `${action}|${fileKey(file)}|${fileKey(zip)}`;
  // Apply only after a dry run of exactly this action + file (+ ZIP) that has at least one ready row.
  const canApply = !!dry && dry.key === runKey && dry.s.ok_rows > 0 && !busy;
  const reset = () => { setDry(null); setApplied(null); setErr(null); setInfo(null); };

  const pick = (list: FileList | null) => {
    for (const f of Array.from(list ?? [])) {
      const n = f.name.toLowerCase();
      if (n.endsWith(".zip")) { if (showZip) setZip(f); }
      else if (n.endsWith(".xlsx") || n.endsWith(".csv")) setFile(f);
      else setErr(`${f.name}: only .xlsx, .csv${showZip ? " or .zip" : ""} files are accepted`);
    }
    setDry(null); setApplied(null);
  };
  const run = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(dryRun ? "dry" : "apply"); setErr(null); setInfo(null);
    try {
      const s = await api.importFile({ action, dry_run: dryRun, file, zip_file: showZip ? zip : null });
      if (dryRun) { setDry({ key: runKey, s }); setApplied(null); } else { setApplied(s); setDry(null); logs.reload(); }
    } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  };
  const template = async () => {
    setBusy("template"); setErr(null);
    try { setInfo(`Downloaded ${await api.downloadTemplate(action)}`); } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  };
  const shown = applied ?? dry?.s ?? null;
  const problemRows = (shown?.rows ?? []).filter((r) => r.result !== "OK" || r.warning);
  const isMark = action === "MARK";
  const logRows: ImportLog[] = logs.data?.items ?? [];

  return (
    <RoleGate roles={["OPS", "ACCOUNTS"]}>
      <div className="page">
        <Head back={{ href: `/${panel.toLowerCase()}`, label: "Back to cases" }} crumbs="Lost & Damage / Cases / Bulk update" title="Bulk update via Excel" />

        <Step n={1} t="Download template">
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--grey-text)", fontWeight: 500 }}>Action
              <select className="select" style={{ width: 280 }} value={action} onChange={(e) => { setAction(e.target.value as ImportAction); if (e.target.value === "MARK") setZip(null); reset(); }}>
                {IMPORT_ACTIONS.map((a) => <option key={a} value={a}>{LABEL[a]}</option>)}
              </select></label>
            <button className="btn" disabled={busy !== null} onClick={template}>{busy === "template" ? "Downloading…" : "⭳ Download .xlsx template"}</button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "12px 0 8px" }}>{colsFor(action).map((c) => <span key={c} className="chip grey" style={{ borderRadius: 6, fontWeight: 500 }}>{c}</span>)}</div>
          <p className="note-sm">{NOTE[action] ?? "Manual and API-marked open cases can be updated. One row per AWB."}</p>
        </Step>

        <Step n={2} t="Upload files">
          <div style={{ display: "grid", gridTemplateColumns: showZip ? "1fr 1fr" : "1fr", gap: 12, marginBottom: 12 }}>
            <div className="fileline" style={{ marginTop: 0 }}>
              <span className="chip green">{file ? (file.name.split(".").pop() ?? "").toUpperCase() : "XLSX"}</span>
              <div style={{ flex: 1 }}><b>{file?.name ?? "No sheet chosen"}</b><div className="sub">{file ? `${Math.round(file.size / 1024)} KB` : ".xlsx or .csv, required"}</div></div>
              {file && <button className="x" style={{ border: 0, background: "none" }} onClick={() => { setFile(null); reset(); }}>×</button>}
            </div>
            {showZip && (
              <div className="fileline" style={{ marginTop: 0 }}>
                <span className="chip purple">ZIP</span>
                <div style={{ flex: 1 }}><b>{zip?.name ?? "No ZIP chosen"}</b><div className="sub">{zip ? `${(zip.size / 1048576).toFixed(1)} MB` : needsZip ? "Required for CN received: CN files" : "Optional: attachments"}</div></div>
                {zip ? <button className="x" style={{ border: 0, background: "none" }} onClick={() => { setZip(null); setDry(null); }}>×</button> : <button className="btn btn-sm" onClick={() => zipRef.current?.click()}>Select ZIP</button>}
              </div>
            )}
          </div>
          <div className="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files); }}>
            <div className="big">{file ? "Replace files or drop new ones" : "Drag and drop your files"}</div>
            <div className="small">.xlsx or .csv{showZip ? " · ZIP of PDF/JPEG/PNG up to 50 MB" : ""}</div>
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>Select file</button>
          </div>
          <input ref={fileRef} type="file" hidden accept={showZip ? ".xlsx,.csv,.zip" : ".xlsx,.csv"} multiple={showZip} onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
          <input ref={zipRef} type="file" hidden accept=".zip" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn" disabled={!file || busy !== null || (needsZip && !zip)} title={needsZip && !zip ? "CN received needs the ZIP of CN files" : ""} onClick={() => run(true)}>{busy === "dry" ? "Validating…" : "Validate (dry run)"}</button>
            <button className="btn btn-dark" disabled={!canApply} title={canApply ? "" : "Run a dry run of this exact file first; it must have rows ready to apply"} onClick={() => run(false)}>{busy === "apply" ? "Applying…" : `Upload & ${isMark ? "Mark cases" : "Update status"}`}</button>
          </div>
          {err && <div className="banner red" style={{ marginTop: 12 }}><div>{err}</div></div>}
          {info && !err && <p className="okline">{info}</p>}
        </Step>

        <Step n={3} t={applied ? "Import result" : "Review validation"} right={shown && <span className={`chip ${applied ? "green" : "blue"}`}>{applied ? `Applied · log ${applied.log_id ?? "—"}` : "Dry run · nothing changed"}</span>}>
          {!shown ? <p className="note-sm">Validate a file to see rows read, rows ready to apply and the error rows. Nothing is written by a dry run.</p> : <>
            <div className={`kpis ${isMark ? "c4" : "c3"}`} style={isMark ? { gridTemplateColumns: "repeat(5, minmax(0,1fr))" } : undefined}>
              <Tile l="Rows read" v={nf(shown.total_rows)} />
              <Tile l={applied ? "Applied" : "Ready to apply"} v={nf(shown.ok_rows)} tone="green" />
              <Tile l="Errors (skipped)" v={nf(shown.error_rows)} tone={shown.error_rows ? "red" : undefined} />
              {shown.skipped_rows !== undefined && <Tile l="Skipped (open case)" v={nf(shown.skipped_rows)} tone="orange" />}
              {shown.warning_rows !== undefined && <Tile l="Warnings" v={nf(shown.warning_rows)} tone="orange" />}
            </div>
            {dry && dry.key !== runKey && <div className="banner amber" style={{ marginBottom: 10 }}><div>The file or action changed since this dry run. Validate again before applying.</div></div>}
            {!applied && dry && dry.s.ok_rows === 0 && <div className="banner amber" style={{ marginBottom: 10 }}><div>No rows are ready to apply. Fix the errors and validate again.</div></div>}
            <table className="tbl"><thead><tr><th>Row</th><th>AWB</th><th>Case</th><th>Result</th><th>Error / warning</th></tr></thead>
              <tbody>{problemRows.slice(0, 200).map((r) => (
                <tr key={r.row}><td>{r.row}</td><td className="mono">{r.airwabilno ?? "—"}</td><td>{r.case_id ?? "—"}</td>
                  <td><span className={`chip ${r.result === "ERROR" ? "red" : r.result === "SKIPPED" ? "amber" : "amber"}`}>{r.result === "OK" ? "Warning" : r.result}</span></td>
                  <td>{[r.error, r.warning].filter(Boolean).join(" · ")}</td></tr>))}
                {!problemRows.length && <tr><td colSpan={5} className="okline">All {nf(shown.total_rows)} rows are ready{applied ? " and were applied" : ""}.</td></tr>}</tbody></table>
            <p className="note-sm">Showing {Math.min(200, problemRows.length)} of {problemRows.length} rows with errors{isMark ? ", skips or warnings" : ""} · error rows are skipped; nothing changes for them.</p>
          </>}
        </Step>

        <div className="card card-pad">
          <h2>Bulk update logs</h2>
          <Status loading={logs.loading} error={logs.error} />
          <table className="tbl"><thead><tr><th>Uploaded</th><th>Action</th><th>File</th><th>Status</th><th className="num">Rows</th><th className="num">OK</th><th className="num">Errors</th><th>By</th><th>Error file</th><th /></tr></thead>
            <tbody>{logRows.map((r) => (
              <Fragment key={r._id}><tr><td>{dayFull(r.uploaded?.at)}<div className="sub mono">{r._id}</div></td><td>{LABEL[r.action as ImportAction] ?? r.action}</td>
                <td>{r.file_name}{r.zip_name && <div className="sub">{r.zip_name}</div>}</td>
                <td><span className={`chip ${STATUS_CHIP[r.status] ?? "grey"}`}>{r.status}</span></td>
                <td className="num">{nf(r.total_rows)}</td><td className="num t-green">{nf(r.ok_rows)}</td><td className={`num${r.error_rows ? " t-red" : ""}`}>{nf(r.error_rows)}</td>
                <td>{r.uploaded?.name ?? "—"}{r.uploaded?.role && <div className="sub">{r.uploaded.role}</div>}</td>
                <td>{r.error_file_url ? <a className="vlink" href={r.error_file_url} target="_blank" rel="noreferrer">Download</a> : "—"}</td>
                <td><button type="button" className="vlink" aria-expanded={openLog === r._id} onClick={() => toggleLog(r._id)}>{openLog === r._id ? "Hide errors" : "View errors"}</button></td></tr>
                {openLog === r._id && logErrors?.id === r._id && (
                  <tr><td colSpan={10}>
                    {logErrors.loading && <p className="note-sm">Loading errors...</p>}
                    {logErrors.error && <p className="note-sm t-red">{logErrors.error}</p>}
                    {logErrors.data && !logErrors.data.errors.length && <p className="note-sm">No errors</p>}
                    {logErrors.data && logErrors.data.errors.length > 0 && (
                      <table className="tbl"><thead><tr><th className="num">Row</th><th>AWB</th><th>Message</th></tr></thead>
                        <tbody>{logErrors.data.errors.map((e, i) => <tr key={`${e.row}-${i}`}><td className="num">{e.row}</td><td className="mono">{e.airwabilno}</td><td>{e.error}</td></tr>)}</tbody></table>)}
                    {logErrors.data?.error_file_url && <a className="vlink" href={logErrors.data.error_file_url} target="_blank" rel="noreferrer">Download error file</a>}
                  </td></tr>)}</Fragment>))}</tbody></table>
          {!logs.loading && !logs.error && !logRows.length && <p className="note-sm">No imports yet.</p>}
          {logs.data && <Pager page={logs.data.page} total={logs.data.total} pageSize={logs.data.page_size} set={setPage} noun="imports" />}
        </div>
      </div>
    </RoleGate>
  );
}
