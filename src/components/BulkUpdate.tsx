"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DownloadIcon } from "./ui";
import { BULK_ACTIONS, BULK_COLUMNS, BULK_HELP, BULK_LABEL, type BulkAction } from "@/lib/bulk-meta";
import { csvCell, fileSize, inr } from "@/lib/format";

type Err = { row: number; ref?: string; awb?: string; error: string };
type Validation = { total: number; ready: number; errors: Err[]; cnValue: number; zipFiles: number };
type Outcome = { applied: number; failed: { row: number; error: string }[] };

const ext = (f: File) => f.name.split(".").pop()?.toLowerCase();

export function BulkUpdate() {
  const router = useRouter();
  const [action, setAction] = useState<BulkAction>("CN_RECEIVED");
  const [xlsx, setXlsx] = useState<File | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [v, setV] = useState<Validation | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function take(files: FileList | File[]) {
    setError(null);
    setOutcome(null);
    for (const f of Array.from(files)) {
      if (["xlsx", "xls", "csv"].includes(ext(f) ?? "")) setXlsx(f);
      else if (ext(f) === "zip") setZip(f);
      else setError(`${f.name}: upload an .xlsx sheet and, optionally, a .zip of documents.`);
    }
  }

  const form = (dryRun: boolean) => {
    const fd = new FormData();
    fd.append("action", action);
    fd.append("dryRun", String(dryRun));
    if (xlsx) fd.append("file", xlsx);
    if (zip) fd.append("zip", zip);
    return fd;
  };

  // Validate as soon as there is a sheet (and again when the action or ZIP changes).
  useEffect(() => {
    if (!xlsx) { setV(null); return; }
    let alive = true;
    setBusy(true);
    setError(null);
    fetch("/api/import", { method: "POST", body: form(true) })
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (!alive) return;
        if (!ok) { setV(null); setError(data.error ?? "Could not read the file."); } else setV(data);
      })
      .catch(() => alive && setError("Could not reach the server."))
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [xlsx, zip, action]); // eslint-disable-line react-hooks/exhaustive-deps

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/import", { method: "POST", body: form(false) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not apply the updates.");
      setOutcome({ applied: data.applied, failed: data.failed });
      setXlsx(null); setZip(null); setV(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function errorFile() {
    if (!v) return;
    const body = [["Row", "AWB / Order no.", "Error"], ...v.errors.map((e) => [e.row, e.ref ?? e.awb ?? "", e.error])].map((r) => r.map(csvCell).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
    a.download = "bulk-update-errors.csv";
    a.click();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="two-col a" style={{ marginBottom: 0 }}>
        <div className="card card-pad">
          <h2><span className="stepnum">1</span>Download template</h2>
          <div className="field" style={{ marginBottom: 14 }}>
            <div className="lbl">Action</div>
            <select className="select" style={{ maxWidth: 320 }} value={action} onChange={(e) => { setAction(e.target.value as BulkAction); setOutcome(null); }}>
              {BULK_ACTIONS.map((a) => <option key={a} value={a}>{BULK_LABEL[a]}</option>)}
            </select>
          </div>
          <div className="note-sm" style={{ marginBottom: 8 }}>Columns in this template (* required)</div>
          <div className="code-chips">
            {BULK_COLUMNS[action].map(([c, req]) => <span key={c} className={`code-chip${req ? "" : " opt"}`}>{c}{req ? " ★" : ""}</span>)}
          </div>
          <p className="note-sm" style={{ margin: "14px 0" }}>{BULK_HELP[action]}</p>
          <a className="btn btn-teal" href={`/api/import/template?action=${action}`}><DownloadIcon /> Download .xlsx template</a>
        </div>

        <div className="card card-pad">
          <h2><span className="stepnum">2</span>Upload files</h2>
          {xlsx && <div className="fileline" style={{ marginBottom: 10 }}><span className="ftype XLSX">XLSX</span><span>{xlsx.name}</span><span style={{ marginLeft: "auto" }} className="sz">{v ? `${v.total} rows` : fileSize(xlsx.size)}</span></div>}
          {zip && <div className="fileline" style={{ marginBottom: 10 }}><span className="ftype ZIP">ZIP</span><span>{zip.name}</span><span style={{ marginLeft: "auto" }} className="sz">{v ? `${v.zipFiles} files · ` : ""}{fileSize(zip.size)}</span></div>}
          <div className={`drop${over ? " over" : ""}`} onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}>
            <div className="big"><b>{xlsx || zip ? "Replace files" : "Choose files"}</b> or drop {xlsx || zip ? "new ones" : "them here"}</div>
            <div className="small">.xlsx up to 2,000 rows · ZIP of PDF/JPEG/PNG up to 50 MB</div>
            <input ref={input} type="file" hidden multiple accept=".xlsx,.xls,.csv,.zip" onChange={(e) => { if (e.target.files) take(e.target.files); e.target.value = ""; }} />
          </div>
        </div>
      </div>

      {error && <div className="banner red" style={{ margin: 0 }}><div>{error}</div></div>}
      {outcome && (
        <div className={`banner ${outcome.failed.length ? "amber" : "green"}`} style={{ margin: 0 }}>
          <div><b>{outcome.applied} update{outcome.applied === 1 ? "" : "s"} applied.</b>{outcome.failed.length > 0 && ` ${outcome.failed.length} row(s) could not be applied: ${[...new Set(outcome.failed.map((f) => f.error))].join("; ")}`}</div>
        </div>
      )}

      <div className="card card-pad">
        <h2><span className="stepnum">3</span>Review validation</h2>
        {!v && <div className="note-sm">{busy ? "Checking the sheet…" : "Upload the sheet to see what will change. Nothing is saved until you press Apply."}</div>}
        {v && (
          <>
            <div className="stat-tiles" style={{ marginBottom: 16 }}>
              <div className="stat-tile">Rows read<b>{v.total}</b></div>
              <div className="stat-tile green">Ready to apply<b>{v.ready}</b></div>
              <div className="stat-tile red">Errors (skipped)<b>{v.errors.length}</b></div>
              <div className="stat-tile">{action === "CN_RECEIVED" ? "CN value to record" : "Cases to update"}<b>{action === "CN_RECEIVED" ? inr(v.cnValue) : v.ready}</b></div>
            </div>
            {v.errors.length > 0 && (
              <div className="mini-tbl" style={{ marginBottom: 16 }}>
                <table>
                  <thead><tr><th style={{ width: 70 }}>Row</th><th style={{ width: 170 }}>AWB</th><th>Error</th></tr></thead>
                  <tbody>{v.errors.slice(0, 10).map((e, i) => <tr key={i}><td>{e.row}</td><td className="mono">{e.ref ?? e.awb}</td><td>{e.error}</td></tr>)}</tbody>
                </table>
                <div className="note-sm" style={{ padding: "10px 14px", borderTop: "1px solid var(--row)" }}>Showing {Math.min(10, v.errors.length)} of {v.errors.length} errors</div>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              {v.errors.length > 0 && <button type="button" className="btn" onClick={errorFile}>Download error file ({v.errors.length} rows)</button>}
              <span className="note-sm" style={{ marginLeft: "auto" }}>Error rows are skipped; nothing changes for them.</span>
              <button type="button" className="btn btn-primary" disabled={busy || v.ready === 0} onClick={apply}>{busy ? "Working…" : `Apply ${v.ready} update${v.ready === 1 ? "" : "s"}`}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
