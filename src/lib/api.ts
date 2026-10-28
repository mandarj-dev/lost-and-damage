"use client";
// Client for the Smart-Finance dispute-operations backend (FastAPI, prefix /dispute-operations).
// Every response is {success, status_code, message, data}. Auth: Authorization: Bearer <token> per role (localStorage).

export const API_ROLES = ["OPS", "ACCOUNTS", "MANAGEMENT", "KAM"] as const;
export type ApiRole = (typeof API_ROLES)[number];

const LS_BASE = "ld_api_base";
const LS_ROLE = "ld_api_role";
const tokenKey = (r: ApiRole) => `ld_api_token_${r}`;
export const DEFAULT_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "https://smart-financeapi-dev.shipdelight.com";
export const PREFIX = "/dispute-operations";

const ls = () => (typeof window === "undefined" ? null : window.localStorage);
export const getBase = () => ls()?.getItem(LS_BASE) || DEFAULT_BASE;
export const setBase = (v: string) => ls()?.setItem(LS_BASE, v.replace(/\/+$/, ""));
export const getRole = (): ApiRole | null => {
  const r = ls()?.getItem(LS_ROLE);
  return (API_ROLES as readonly string[]).includes(r ?? "") ? (r as ApiRole) : null;
};
export const setRole = (r: ApiRole) => { ls()?.setItem(LS_ROLE, r); window.dispatchEvent(new Event("ld-auth")); };
export const getToken = (r: ApiRole) => ls()?.getItem(tokenKey(r)) || "";
export const setToken = (r: ApiRole, t: string) => (t ? ls()?.setItem(tokenKey(r), t.trim()) : ls()?.removeItem(tokenKey(r)));
export const signOut = () => { ls()?.removeItem(LS_ROLE); window.dispatchEvent(new Event("ld-auth")); };

export interface Envelope<T> { success: boolean; status_code?: number; message: string; data?: T }
export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) { super(message); }
}

/** Readable text for auth and validation failures; keeps the backend message when it has one. */
export function friendly(status: number, message: string) {
  if (status === 401) return `Sign-in expired or token missing (401). Paste a fresh token on the sign-in page. ${message}`;
  if (status === 403) return `Your role is not allowed to do this (403). ${message}`;
  if (status === 422) return `The request was rejected as invalid (422): ${message}`;
  return message;
}

type Q = Record<string, string | number | boolean | undefined | null>;
function qs(q?: Q) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q ?? {})) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function call<T>(method: string, path: string, opts: { query?: Q; body?: unknown; form?: FormData; prefix?: string } = {}): Promise<Envelope<T>> {
  const role = getRole();
  const headers: Record<string, string> = {};
  const token = role ? getToken(role) : "";
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(opts.body); }
  let res: Response;
  try {
    res = await fetch(`${getBase()}${opts.prefix ?? PREFIX}${path}${qs(opts.query)}`, { method, headers, body });
  } catch {
    throw new ApiError(0, `Cannot reach ${getBase()} (backend down or CORS not allowing this origin)`);
  }
  const json = (await res.json().catch(() => ({}))) as Partial<Envelope<T>> & { detail?: unknown };
  if (!res.ok || json.success === false) {
    const detail = Array.isArray(json.detail) ? json.detail.map((d: { msg?: string }) => d.msg).join("; ") : (json.detail as string | undefined);
    const status = json.status_code ?? res.status;
    throw new ApiError(status, friendly(status, json.message || detail || `Request failed (${res.status})`), json.data);
  }
  return json as Envelope<T>;
}
const get = <T,>(p: string, query?: Q) => call<T>("GET", p, { query }).then((e) => e.data as T);
const post = <T,>(p: string, body?: unknown) => call<T>("POST", p, { body });
/** Liability masters API (Smart-Finance /liability, same envelope and bearer token). */
export const LIABILITY_PREFIX = "/liability";
const lget = <T,>(p: string, query?: Q) => call<T>("GET", p, { query, prefix: LIABILITY_PREFIX }).then((e) => e.data as T);

/** GET an XLSX (not an envelope) and save it through a blob link so the bearer token is sent; returns the saved file name. */
async function saveDownload(prefix: string, path: string, query: Q, fallbackName: string) {
  const role = getRole();
  const token = role ? getToken(role) : "";
  let res: Response;
  try {
    res = await fetch(`${getBase()}${prefix}${path}${qs(query)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiError(0, `Cannot reach ${getBase()} (backend down or CORS not allowing this origin)`);
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { message?: string; detail?: unknown };
    const detail = Array.isArray(j.detail) ? j.detail.map((d: { msg?: string }) => d.msg).join("; ") : (j.detail as string | undefined);
    throw new ApiError(res.status, friendly(res.status, j.message || detail || `Template download failed (${res.status})`));
  }
  const name = /filename="?([^";]+)"?/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

// ---- shared shapes (loose: backend returns Mongo docs) ----
export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Page<T = Row> { items: T[]; total: number; page: number; page_size: number }
export interface EvidenceFile { key: string; name: string; size: number; content_type: string }
export type Disposition = "CLAIM_SENT" | "FOLLOW_UP" | "CN_RECEIVED" | "CN_REJECTED" | "FOUND" | "ESCALATE";

export interface DisputeListQuery {
  tab?: "open" | "closed"; view?: "awb" | "courier" | "client"; case_type?: "LOST" | "DAMAGED"; q?: string;
  courier_code?: string; courier_name?: string; tenant_id?: string; marked_from?: string; marked_to?: string; status?: string;
  source?: "MANUAL" | "API"; window_lte?: number; pending_at?: "COURIER" | "ACCOUNTS" | "MANAGEMENT"; page?: number; without_case?: boolean;
}
export interface FilterOptions { clients: { tenant_id: string; client_name: string }[]; couriers: { courier_name: string; courier_label: string; courier_codes: string[] }[] }
export interface CourierCnInput {
  cn_number: string; cn_date: string; total_amount: number; lines: { dispute_id: string; amount: number; short_reason?: string }[];
  document: EvidenceFile; expected_mode?: "FREIGHT_BILL" | "UTR"; expected_freight_month?: string;
}

export const IMPORT_ACTIONS = ["CLAIM_SENT", "FOLLOW_UP", "CN_RECEIVED", "CN_REJECTED", "FOUND", "ESCALATE", "MARK"] as const;
export type ImportAction = (typeof IMPORT_ACTIONS)[number];
export interface ImportRow { row: number; airwabilno: string | null; case_id?: string | null; result: "OK" | "ERROR" | "SKIPPED"; error: string | null; warning?: string | null }
/** POST /import data: build_import_summary (+ skipped_rows / warning_rows for MARK). */
export interface ImportSummary { log_id: string | null; dry_run: boolean; total_rows: number; ok_rows: number; error_rows: number; skipped_rows?: number; warning_rows?: number; rows: ImportRow[] }
/** GET /import/logs item (dispute_import_logs without `errors`, plus error_file_url). */
export interface ImportLog { _id: string; action: string; file_name: string; zip_name?: string | null; dry_run: boolean; status: "PROCESSING" | "DONE" | "FAILED"; total_rows: number; ok_rows: number; error_rows: number; error_file_url?: string | null; uploaded?: { name?: string; role?: string; at?: string }; finished_at?: string | null }
/** GET /import/logs/{log_id} data: one log's stored errors (capped at 200). */
export interface ImportLogErrors { log_id: string; status: ImportLog["status"]; total_rows: number | null; ok_rows: number | null; error_rows: number | null; errors: { row: number; airwabilno: string; error: string }[]; error_file_url?: string | null }

export type LiabilityEntity = "client" | "courier";
/** History entry of a master's liability_history (effective_from is YYYY-MM-DD; liability_amount null = no max L). */
export interface LiabilityTerm { effective_from: string; liability_amount: number | null; cof: boolean; updated_by?: { user_id?: string | null; name?: string | null }; updated_at?: string | null }
/** GET /liability/masters item: the term effective today. */
export interface LiabilityMaster { entity_type: LiabilityEntity; key: string; name?: string | null; liability_amount: number | null; cof: boolean; effective_from: string | null; history_count: number; has_disputes?: boolean }
/** GET /liability/masters?entity_type=courier&grouped=true item: codes grouped by courier name; term_summary is null when the codes differ. */
export interface LiabilityCourierGroup { entity_type: "courier"; key: string; name: string; code_count: number; codes: LiabilityMaster[]; term_summary: { liability_amount: number | null; cof: boolean; effective_from: string | null } | null; is_mixed: boolean }
export interface LiabilityGroupSaveResult { entity_type: "courier"; key: string; entry: LiabilityTerm; saved_codes: string[]; failed_codes: { courier_code: string; error: string }[]; disputes_recalculated: number }
export interface LiabilityChangeLog { _id: string; old_entry: LiabilityTerm | null; new_entry: LiabilityTerm; actor?: { name?: string | null; role?: string }; at: string; source: "single" | "bulk" }
export interface LiabilityHistory extends LiabilityMaster { history: LiabilityTerm[]; change_logs: LiabilityChangeLog[] }
export interface LiabilityTermInput { entity_type: LiabilityEntity; key: string; effective_from: string; liability_amount: number | null; cof: boolean }
export interface LiabilitySaveResult { entity_type: LiabilityEntity; key: string; entry: LiabilityTerm; current_term: { liability_amount: number | null; cof: boolean }; disputes_recalculated: number }
export interface LiabilityImportRow { row: number; entity_type: string | null; key: string | null; result: "OK" | "ERROR"; error: string | null; disputes_recalculated: number }
export interface LiabilityImportSummary { log_id: string | null; dry_run: boolean; total_rows: number; ok_rows: number; error_rows: number; disputes_recalculated: number; rows: LiabilityImportRow[] }
export interface LiabilityImportLog { _id: string; file_name: string; status: "PROCESSING" | "DONE" | "FAILED"; total_rows: number; ok_rows: number; error_rows: number; disputes_recalculated: number; error_file_url?: string | null; uploaded?: { name?: string; at?: string }; finished_at?: string | null }

export const api = {
  // cases
  lookup: (q: { awb?: string; order_no?: string }) => get<Row[]>("/shipments/lookup", q),
  markCase: (b: { orderno: string; airwaybilno: string; case_type: "LOST" | "DAMAGED"; mark_reason: string; client_reported_on: string; client_ticket_ref?: string; ops_remarks?: string; evidence: EvidenceFile[] }) => post<Row>("/disputes", b),
  listDisputes: (q: DisputeListQuery) => get<Page>("/disputes", q as Q),
  dispute: (id: string) => get<Row>(`/disputes/${id}`),
  updateStatus: (b: { dispute_ids: string[]; disposition: Disposition; remarks?: string; reason?: string; courier_cn?: CourierCnInput }) => post<{ updated: string[]; failed: Row[] }>("/disputes/status", b),
  checkCn: (q: { client_cn_number?: string; courier_code?: string; courier_cn_number?: string }) => get<Row>("/checks", q),
  comment: (id: string, b: { text: string; attachments?: EvidenceFile[] }) => post<Row>(`/disputes/${id}/comments`, { attachments: [], ...b }),
  handoff: (id: string, b: { to: "OPS" | "ACCOUNTS"; remarks?: string }) => post<Row>(`/disputes/${id}/handoff`, b),
  // approvals
  requestException: (b: { dispute_id: string; exception_type: string; reasons?: string[]; requested_amount?: number; justification: string; approver_user_id: string; needed_by?: string; documents?: EvidenceFile[] }) => post<Row>("/disputes/exception", b),
  approvals: (q: { tab?: "approvals" | "escalations" | "decided"; page?: number }) => get<Page>("/approvals", q),
  approvers: () => get<Row[]>("/approvers"),
  decide: (disputeId: string, approvalId: string, b: { decision: "APPROVE" | "REJECT" | "SEND_BACK"; note?: string }) => post<Row>(`/approvals/${disputeId}/${approvalId}`, b),
  release: (b: { cases: { dispute_id: string; client_cn_number: string; client_cn_date: string; amount: number; attachments: EvidenceFile[]; remarks?: string }[]; checked: boolean }) => post<Row>("/disputes/release", b),
  // courier CNs & settlements
  courierCns: (q: { settlement_state?: string; courier_code?: string; courier_name?: string; expected_mode?: string; q?: string; page?: number }) => get<Page>("/courier-cns", q),
  settle: (b: { mode: "FREIGHT_BILL" | "UTR"; utr?: string; freight_month?: string; freight_bill_no?: string; amount: number; settled_on: string; proof: EvidenceFile; remarks?: string; items: { courier_cn_id: string; amount: number }[] }) => post<Row>("/settlements", b),
  chase: (courierCnId: string) => post<{ chased_count: number }>(`/courier-cns/${courierCnId}/chase`),
  // uploads & imports
  upload: async (files: File[], disputeId?: string): Promise<EvidenceFile[]> => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    if (disputeId) fd.append("dispute_id", disputeId);
    return (await call<EvidenceFile[]>("POST", "/uploads", { form: fd })).data ?? [];
  },
  /** POST /import (multipart). dry_run=true validates only and writes nothing. */
  importFile: async (b: { action: ImportAction; dry_run: boolean; file: File; zip_file?: File | null }) => {
    const fd = new FormData();
    fd.append("action", b.action);
    fd.append("dry_run", String(b.dry_run));
    fd.append("file", b.file);
    if (b.zip_file) fd.append("zip_file", b.zip_file);
    return (await call<ImportSummary>("POST", "/import", { form: fd })).data as ImportSummary;
  },
  /** GET /import/template?action=… returns an XLSX (not an envelope); saved through a blob link so the bearer token is sent. */
  downloadTemplate: (action: ImportAction) => saveDownload(PREFIX, "/import/template", { action }, `ld_bulk_update_${action.toLowerCase()}.xlsx`),
  importLogs: (page = 1) => get<Page<ImportLog>>("/import/logs", { page }),
  importLogErrors: (logId: string) => get<ImportLogErrors>(`/import/logs/${encodeURIComponent(logId)}`),
  // liability masters (/liability)
  liabilityMasters: (q: { entity_type: LiabilityEntity; search?: string; page?: number }) => lget<Page<LiabilityMaster>>("/masters", q),
  liabilityHistory: (entityType: LiabilityEntity, key: string) => lget<LiabilityHistory>(`/masters/${entityType}/${encodeURIComponent(key)}/history`),
  liabilityCourierGroups: (q: { search?: string; page?: number }) => lget<Page<LiabilityCourierGroup>>("/masters", { ...q, entity_type: "courier", grouped: true }),
  /** POST /liability/terms/courier-group: the same term on every code of the group; status 207 (success false) when some codes failed. */
  saveCourierGroupTerm: async (b: { courier_name: string; effective_from: string; liability_amount: number | null; cof: boolean }) => {
    try {
      return (await call<LiabilityGroupSaveResult>("POST", "/terms/courier-group", { body: b, prefix: LIABILITY_PREFIX })).data as LiabilityGroupSaveResult;
    } catch (e) {
      if (e instanceof ApiError && e.status === 207 && e.data) return e.data as LiabilityGroupSaveResult;
      throw e;
    }
  },
  saveLiabilityTerm: async (b: LiabilityTermInput) => (await call<LiabilitySaveResult>("POST", "/terms", { body: b, prefix: LIABILITY_PREFIX })).data as LiabilitySaveResult,
  /** POST /liability/import (multipart). dry_run=true validates only and writes nothing. */
  liabilityImport: async (b: { dry_run: boolean; file: File }) => {
    const fd = new FormData();
    fd.append("dry_run", String(b.dry_run));
    fd.append("file", b.file);
    return (await call<LiabilityImportSummary>("POST", "/import", { form: fd, prefix: LIABILITY_PREFIX })).data as LiabilityImportSummary;
  },
  liabilityTemplate: () => saveDownload(LIABILITY_PREFIX, "/import/template", {}, "liability_terms_template.xlsx"),
  liabilityImportLogs: (page = 1) => lget<Page<LiabilityImportLog>>("/import/logs", { page }),
  // filter dropdowns: client names (value tenant_id) and courier names (label courier_label, value raw courier_name, expanded to its codes by the backend)
  filterOptions: () => get<FilterOptions>("/filters/options"),
  // reports
  kamLiability: (q: { view?: "awb" | "courier" | "client"; tab?: "open" | "closed"; q?: string; courier_code?: string; courier_name?: string; tenant_id?: string; marked_from?: string; marked_to?: string; page?: number }) => get<Page & { pending_summary?: Row[] }>("/kam/liability", q),
  clientStatement: (tenantId: string, q: { tab?: "open" | "closed"; marked_from?: string; marked_to?: string; page?: number }) => get<Row>(`/kam/clients/${tenantId}/statement`, q),
  managementReport: (q: { courier_code?: string; courier_name?: string; tenant_id?: string; marked_from?: string; marked_to?: string }) => get<{ scorecard: Row[]; sd_gap_by_month: Row[]; client_view: Row[]; decision_time: Row[]; closed_groupings: Row[]; pending_by_age: Row[] }>("/reports/management", q),
};
