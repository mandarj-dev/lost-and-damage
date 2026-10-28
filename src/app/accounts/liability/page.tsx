"use client";
// Liability masters (Accounts): client and courier L&D liability terms with effective-from history, wired to /liability.
import { Fragment, useState, type ReactNode } from "react";
import { DataTable, RoleGate, Status, useApi } from "@/components/ApiKit";
import { LiabilityTermDrawer, type LiabilitySaved, LiabilityTermText } from "@/components/FigmaDrawers";
import { Head, Ico, Pager, PTabs, dayFull, nf } from "@/components/FigmaKit";
import { api, type LiabilityCourierGroup, type LiabilityEntity, type LiabilityImportSummary, type LiabilityMaster, type LiabilityTerm, type Row } from "@/lib/api";

const LEGACY = "1970-01-01";

/** One liability presentation everywhere: bold ₹ amount, soft grey "Not defined", one amber COF pill. */
const Term = ({ amount, cof }: { amount: number | null | undefined; cof: boolean }) => <LiabilityTermText amount={amount} cof={cof} />;
const Since = ({ v }: { v: string | null | undefined }) => (v && v !== LEGACY ? <span className="nw">{dayFull(v)}</span> : <span className="muted">From the start</span>);
const NameCell = ({ name, sub, badge }: { name: ReactNode; sub: ReactNode; badge?: ReactNode }) => (
  <div><div style={{ display: "flex", gap: 8, alignItems: "center" }}><b>{name}</b>{badge}</div><div className="sub mono">{sub}</div></div>
);
const SOURCES: Record<string, string> = { bulk: "Bulk upload", group: "Courier group", edit_client: "Client edit", single: "Single" };
// Client audit entries are stored in client_master's lost_liability_history shape; courier ones already are LiabilityTerm.
const asTerm = (e: Row | null | undefined): LiabilityTerm | null => (!e ? null : "lost_liability_date" in e
  ? { effective_from: String(e.lost_liability_date ?? "").slice(0, 10), liability_amount: (e.lost_liability_amount as number | null) ?? null, cof: !!e.cof_enabled }
  : (e as unknown as LiabilityTerm));
// "YYYY-MM-DD HH:MM:SS" IST strings (client history) are shown as stored; ISO datetimes are localised.
const stamp = (v: string) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? v : new Date(v).toLocaleString("en-IN"));
const showing = (page: number, size: number, total: number) => (total ? `Showing ${(page - 1) * size + 1}-${Math.min(page * size, total)} of ${nf(total)}` : "No results");

function History({ master, onClose }: { master: LiabilityMaster; onClose: () => void }) {
  const res = useApi(() => api.liabilityHistory(master.entity_type, master.key), [master.entity_type, master.key, master.history_count]);
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><h2 style={{ margin: 0 }}>History · {master.name ?? master.key}</h2><div className="sub mono muted">{master.key}</div></div>
        <button className="btn btn-sm" onClick={onClose}>Close</button>
      </div>
      <Status loading={res.loading} error={res.error} />
      <DataTable rows={(res.data?.history ?? []) as Row[]} empty="No dated terms yet: the master's own fields apply from the start." cols={[
        { key: "effective_from", label: "Effective from", render: (r) => <Since v={r.effective_from} /> },
        { key: "liability_amount", label: "Liability", render: (r) => <Term amount={r.liability_amount} cof={!!r.cof} /> },
        { key: "updated_by", label: "Updated by", render: (r) => r.updated_by?.name ?? <span className="muted">-</span> },
        { key: "updated_at", label: "Updated at", render: (r) => (r.updated_at ? stamp(r.updated_at) : <span className="muted">-</span>) }]} />
      <div className="card-pad"><h2 style={{ margin: 0 }}>Audit trail</h2></div>
      <DataTable rows={(res.data?.change_logs ?? []) as Row[]} empty="No changes logged yet." cols={[
        { key: "at", label: "When", render: (r) => new Date(r.at).toLocaleString("en-IN") },
        { key: "actor", label: "Who", render: (r) => r.actor?.name ?? "-" },
        { key: "source", label: "Source", render: (r) => <span className="chip grey">{SOURCES[r.source] ?? "Single"}</span> },
        { key: "change", label: "Change", render: (r) => { const o = asTerm(r.old_entry); const n = asTerm(r.new_entry) as LiabilityTerm; return <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}><Since v={n.effective_from} />:{o ? <><Term amount={o.liability_amount} cof={o.cof} />→</> : <span className="chip teal">New</span>}<Term amount={n.liability_amount} cof={n.cof} /></span>; } }]} />
    </div>
  );
}

function BulkUpload({ onApplied }: { onApplied: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<null | "template" | "dry" | "apply">(null);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<LiabilityImportSummary | null>(null);
  const [page, setPage] = useState(1);
  const logs = useApi(() => api.liabilityImportLogs(page), [page]);
  const run = async (kind: "template" | "dry" | "apply") => {
    setBusy(kind); setErr(null);
    try {
      if (kind === "template") await api.liabilityTemplate();
      else if (file) {
        setSummary(await api.liabilityImport({ dry_run: kind === "dry", file }));
        if (kind === "apply") { logs.reload(); onApplied(); }
      }
    } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  };
  const errors = (summary?.rows ?? []).filter((r) => r.error) as Row[];
  const step = (n: number, title: string, body: ReactNode) => (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: 1, minWidth: 240 }}>
      <span className="chip teal" style={{ minWidth: 24, textAlign: "center" }}>{n}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}><b>{title}</b>{body}</div>
    </div>
  );
  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="card-pad">
        <h2 style={{ margin: "0 0 4px" }}>Bulk upload</h2>
        <div className="note-sm">One row per term: Type (client / courier), Key (tenant_id or courier_code), Effective From, Liability Amount (blank = none), COF (TRUE / FALSE).</div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 16 }}>
          {step(1, "Download template", <button className="btn btn-sm" disabled={!!busy} onClick={() => run("template")}>{Ico.down} Template</button>)}
          {step(2, "Choose file", <input type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setSummary(null); }} />)}
          {step(3, "Validate, then apply", <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-sm" disabled={!file || !!busy} onClick={() => run("dry")}>{busy === "dry" ? "Checking…" : "Dry run"}</button>
            <button className="btn btn-sm btn-primary" disabled={!file || !!busy || !summary?.dry_run || summary.ok_rows === 0} title={summary?.dry_run ? "" : "Run a dry run first"} onClick={() => run("apply")}>{busy === "apply" ? "Applying…" : "Apply valid rows"}</button>
          </div>)}
        </div>
        {err && <div className="banner red" style={{ marginTop: 16, marginBottom: 0 }}>{err}</div>}
        {summary && (
          <div className={`banner ${summary.error_rows ? "amber" : "green"}`} style={{ marginTop: 16, marginBottom: 0 }}>
            <span><b>{summary.dry_run ? "Dry run" : "Applied"}:</b> {nf(summary.total_rows)} rows · {nf(summary.ok_rows)} valid · {nf(summary.error_rows)} with errors{summary.dry_run ? "" : ` · ${nf(summary.disputes_recalculated)} disputes recalculated`}</span>
          </div>
        )}
      </div>
      {errors.length > 0 && <DataTable rows={errors} cols={[{ key: "row", label: "Row" }, { key: "entity_type", label: "Type" }, { key: "key", label: "Key", render: (r) => <span className="mono">{r.key ?? "-"}</span> }, { key: "error", label: "Error", render: (r) => <span className="t-red">{r.error}</span> }]} />}
      <div className="card-pad" style={{ paddingBottom: 0 }}><h2 style={{ margin: 0 }}>Upload log</h2></div>
      <Status loading={logs.loading} error={logs.error} />
      <DataTable rows={(logs.data?.items ?? []) as Row[]} empty="No uploads yet." cols={[
        { key: "file_name", label: "File", render: (r) => <NameCell name={r.file_name} sub={r.uploaded?.at ? new Date(r.uploaded.at).toLocaleString("en-IN") : ""} /> },
        { key: "uploaded", label: "By", render: (r) => r.uploaded?.name ?? "-" },
        { key: "status", label: "Status", render: (r) => <span className={`chip ${({ DONE: "green", FAILED: "red", PROCESSING: "amber" } as Record<string, string>)[r.status] ?? "grey"}`}>{r.status}</span> },
        { key: "rows", label: "Valid / errors", render: (r) => `${nf(r.ok_rows)} / ${nf(r.error_rows)}` },
        { key: "disputes_recalculated", label: "Recalculated", render: (r) => nf(r.disputes_recalculated) },
        { key: "error_file_url", label: "Error file", render: (r) => (r.error_file_url ? <a href={r.error_file_url} target="_blank" rel="noreferrer">Download</a> : <span className="muted">-</span>) }]} />
      {logs.data && logs.data.total > 0 && <Pager page={page} total={logs.data.total} pageSize={logs.data.page_size} set={setPage} noun="uploads" />}
    </div>
  );
}

const CodeActions = ({ m, onHistory, onEdit }: { m: LiabilityMaster; onHistory: () => void; onEdit: () => void }) => (
  <div className="liab-actions">
    <button className="btn btn-sm" onClick={onHistory}>History ({nf(m.history_count)})</button>
    <button className="btn btn-sm btn-primary" style={{ minWidth: 92 }} onClick={onEdit}>Edit term</button>
  </div>
);

export default function LiabilityPage() {
  const [tab, setTab] = useState<LiabilityEntity>("client");
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<{ master: LiabilityMaster; group?: { name: string; label: string; codes: string[] } } | null>(null);
  const [shown, setShown] = useState<LiabilityMaster | null>(null);
  const [open, setOpen] = useState<string[]>([]);
  const [saved, setSaved] = useState<LiabilitySaved | null>(null);
  const clients = useApi(() => (tab === "client" ? api.liabilityMasters({ entity_type: "client", search, page }) : Promise.resolve(null)), [tab, search, page]);
  const couriers = useApi(() => (tab === "courier" ? api.liabilityCourierGroups({ search, page }) : Promise.resolve(null)), [tab, search, page]);
  const res = tab === "client" ? clients : couriers;
  const data = res.data;
  const reload = () => { clients.reload(); couriers.reload(); };
  const switchTab = (t: LiabilityEntity) => { setTab(t); setPage(1); setShown(null); setOpen([]); setText(""); setSearch(""); };
  const groupEdit = (g: LiabilityCourierGroup) => {
    const first = g.codes[0];
    setEdit({ master: { ...first, name: g.name, liability_amount: g.term_summary?.liability_amount ?? null, cof: g.term_summary?.cof ?? false }, group: { name: g.key, label: g.name, codes: g.codes.map((c) => c.key) } });
  };
  const colgroup = <colgroup><col /><col style={{ width: 200 }} /><col style={{ width: 150 }} /><col style={{ width: 230 }} /></colgroup>;
  return (
    <RoleGate roles={["ACCOUNTS"]}>
      <div className="page">
        <Head crumbs="Lost & Damage / Liability masters" title="Liability masters" />
        <p className="note-sm" style={{ marginTop: -12, marginBottom: 16 }}>Maximum liability and COF per client and courier. A dispute uses the term in force on its pickup date (else order date, else the day it was marked).</p>
        {saved && (
          <div className={`banner ${saved.failed.length ? "amber" : "green"}`} role="status">
            <span style={{ flex: 1 }}><b>Saved {saved.label}</b> from {dayFull(saved.effectiveFrom)}. {nf(saved.recalculated)} dispute{saved.recalculated === 1 ? "" : "s"} recalculated.{saved.failed.length ? ` Not saved: ${saved.failed.join("; ")}.` : ""}</span>
            <button className="btn btn-sm" aria-label="Dismiss" onClick={() => setSaved(null)}>✕</button>
          </div>
        )}
        <div className="card">
          <PTabs value={tab} set={switchTab} items={[{ v: "client", label: "Clients" }, { v: "courier", label: "Couriers" }]} />
          <form style={{ display: "flex", gap: 12, alignItems: "center", padding: 16 }} onSubmit={(e) => { e.preventDefault(); setSearch(text.trim()); setPage(1); }}>
            <div style={{ position: "relative", flex: "0 1 380px" }}>
              <span style={{ position: "absolute", left: 12, top: 11, color: "var(--muted)" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg></span>
              <input className="input" style={{ width: "100%", paddingLeft: 36 }} placeholder={tab === "client" ? "Search client name or tenant ID" : "Search courier name or code"} value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            <button className="btn" type="submit">Search</button>
            {search && <button className="btn btn-sm" type="button" onClick={() => { setText(""); setSearch(""); setPage(1); }}>Clear</button>}
            <span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>{data ? `${nf(data.total)} ${tab === "client" ? "clients" : "couriers"}` : ""}</span>
          </form>
          <Status loading={res.loading} error={res.error} />
          {data && !data.items.length && <div className="empty">{search ? `Nothing matches "${search}".` : tab === "client" ? "No clients with disputes yet." : "No masters found."}</div>}
          {data && data.items.length > 0 && (
            <div className="liab-scroll">
              <table className="tbl liab-tbl">
                {colgroup}
                <thead><tr><th>{tab === "client" ? "Client" : "Courier"}</th><th>Current liability</th><th>Effective from</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead>
                <tbody>
                  {tab === "client" && (data.items as LiabilityMaster[]).map((m) => (
                    <tr key={m.key}>
                      <td><NameCell name={m.name ?? m.key} sub={m.key} badge={search && m.has_disputes ? <span className="chip blue sq">Has disputes</span> : undefined} /></td>
                      <td><Term amount={m.liability_amount} cof={m.cof} /></td>
                      <td><Since v={m.effective_from} /></td>
                      <td><CodeActions m={m} onHistory={() => setShown(shown?.key === m.key ? null : m)} onEdit={() => setEdit({ master: m })} /></td>
                    </tr>
                  ))}
                  {tab === "courier" && (data.items as LiabilityCourierGroup[]).map((g) => {
                    const isOpen = open.includes(g.key);
                    return (
                      <Fragment key={g.key}>
                        <tr>
                          <td>
                            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                              <button className="btn btn-sm" aria-label={isOpen ? "Collapse" : "Expand"} onClick={() => setOpen(isOpen ? open.filter((k) => k !== g.key) : [...open, g.key])}>{isOpen ? "▾" : "▸"}</button>
                              <NameCell name={g.name} sub={`${g.code_count} code${g.code_count === 1 ? "" : "s"}: ${g.codes.map((c) => c.key).join(", ")}`} />
                            </div>
                          </td>
                          <td>{g.term_summary ? <Term amount={g.term_summary.liability_amount} cof={g.term_summary.cof} /> : <span className="chip purple">Mixed</span>}</td>
                          <td>{g.term_summary ? <Since v={g.term_summary.effective_from} /> : <span className="muted">Varies</span>}</td>
                          <td><div className="liab-actions"><button className="btn btn-sm btn-primary" style={{ minWidth: 92 }} onClick={() => groupEdit(g)}>Edit term</button></div></td>
                        </tr>
                        {isOpen && g.codes.map((c) => (
                          <tr key={`${g.key}:${c.key}`} className="liab-code">
                            <td style={{ paddingLeft: 58 }}><span className="mono">{c.key}</span></td>
                            <td><Term amount={c.liability_amount} cof={c.cof} /></td>
                            <td><Since v={c.effective_from} /></td>
                            <td><CodeActions m={{ ...c, name: `${g.name} · ${c.key}` }} onHistory={() => setShown(shown?.key === c.key ? null : { ...c, name: `${g.name} · ${c.key}` })} onEdit={() => setEdit({ master: { ...c, name: `${g.name} · ${c.key}` } })} /></td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {data && data.total > 0 && (
            <div className="pager" style={{ borderTop: "1px solid var(--line)" }}>
              <span>{showing(page, data.page_size, data.total)} {tab === "client" ? "clients" : "couriers"}</span>
              <div className="pages">
                <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <span className="on">{page}</span>
                <button className="btn btn-sm" disabled={page * data.page_size >= data.total} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            </div>
          )}
        </div>
        {shown && <History master={shown} onClose={() => setShown(null)} />}
        <BulkUpload onApplied={reload} />
        {edit && <LiabilityTermDrawer master={edit.master} group={edit.group} onClose={() => setEdit(null)} onDone={(s) => {
          setSaved(s);
          reload();
          if (shown && (shown.key === edit.master.key || edit.group?.codes.includes(shown.key))) setShown({ ...shown, history_count: shown.history_count + 1 });
        }} />}
      </div>
    </RoleGate>
  );
}
