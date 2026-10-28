// Bulk status update from Excel (+ optional ZIP of documents): validate row by row, then apply.

import { put } from "@vercel/blob";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { connectDB, q } from "./db";
import { HttpError, badRequest } from "./http";
import { allowedDispositions, round2 } from "./rules";
import { applyDisposition, factsOf } from "./services";
import type { Actor, Disposition } from "./types";
import type { CaseDoc, WithId } from "@/models";

import { BULK_ACTIONS, BULK_ATT as ATT, BULK_COLUMNS, BULK_LABEL, BULK_REF as REF, type BulkAction } from "./bulk-meta";
export { BULK_ACTIONS, BULK_COLUMNS, BULK_LABEL, type BulkAction };

const MAX_ROWS = 2000;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const inrText = (n: number) => `₹${round2(n).toLocaleString("en-IN")}`;

export function templateBuffer(action: BulkAction): Buffer {
  const cols = BULK_COLUMNS[action].map(([c]) => c);
  const sample: Record<BulkAction, (string | number)[]> = {
    CN_RECEIVED: ["7834501926", "DLV/CN/2026/04418", "2026-10-06", 4850, "", "DLV_CN_04418.pdf", ""],
    FOLLOW_UP: ["7834501926", "Reminder sent to courier KAM", ""],
    CLAIM_SENT: ["7834501926", "Claim email with invoice sent", "claim-email.pdf"],
    CN_REJECTED: ["7834501926", "Claim filed after window", "", ""],
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cols, sample[action]]), "Template");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function readSheet(buf: Buffer): Record<string, string>[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw badRequest("The workbook has no sheet.");
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
  if (raw.length === 0) throw badRequest("The sheet is empty.");
  if (raw.length > MAX_ROWS) throw badRequest(`Upload at most ${MAX_ROWS.toLocaleString("en-IN")} rows at a time.`);
  return raw.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [norm(k), v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").trim()]),
    ),
  );
}

export async function zipEntries(buf: Buffer | null): Promise<Map<string, JSZip.JSZipObject>> {
  const out = new Map<string, JSZip.JSZipObject>();
  if (!buf) return out;
  const zip = await JSZip.loadAsync(buf);
  zip.forEach((path, entry) => {
    if (!entry.dir && !path.includes("__MACOSX")) out.set(path.split("/").pop()!.toLowerCase(), entry);
  });
  return out;
}

export interface BulkGroup {
  rows: number[];
  courier: string;
  caseIds: string[];
  disposition: Disposition;
  remarks?: string;
  file?: string;
  cn?: { cnNumber: string; cnDate: string; totalAmount: number; lines: { caseId: string; amount: number; shortReason?: string }[] };
  rejection?: string;
}
export interface BulkResult {
  total: number;
  ready: number;
  errors: { row: number; ref: string; error: string }[];
  cnValue: number;
  zipFiles: number;
  groups: BulkGroup[];
}

const DISPOSITION: Record<BulkAction, Disposition> = { CN_RECEIVED: "CN_RECEIVED", FOLLOW_UP: "FOLLOW_UP", CLAIM_SENT: "CLAIM_SENT", CN_REJECTED: "CN_REJECTED" };

export async function validateBulk(actor: Actor, action: BulkAction, sheet: Record<string, string>[], zip: Map<string, unknown> | null): Promise<BulkResult> {
  await connectDB();
  const get = (r: Record<string, string>, col: string) => r[norm(col)] ?? "";
  const refs = [...new Set(sheet.map((r) => get(r, REF)).filter(Boolean))];
  const cases = refs.length
    ? await q<WithId<CaseDoc>>("SELECT * FROM cases WHERE awb = ANY($1::text[]) OR order_id = ANY($1::text[])", [refs])
    : [];
  const byRef = new Map<string, WithId<CaseDoc>>();
  for (const c of cases) {
    byRef.set(c.awb, c);
    if (c.orderId && !byRef.has(c.orderId)) byRef.set(c.orderId, c);
  }
  const cnNumbers = [...new Set(sheet.map((r) => get(r, "CN No.")).filter(Boolean).map((s) => s.toLowerCase()))];
  const usedCns = action === "CN_RECEIVED" && cnNumbers.length
    ? await q<{ cnNumber: string; courier: string }>("SELECT cn_number, courier FROM courier_cns WHERE lower(cn_number) = ANY($1::text[])", [cnNumbers])
    : [];
  const usedBy = new Map(usedCns.map((u) => [u.cnNumber.toLowerCase(), u.courier]));

  const errors: BulkResult["errors"] = [];
  const cnCourier = new Map<string, string>();
  const seen = new Set<string>();
  type Ok = { row: number; c: WithId<CaseDoc>; r: Record<string, string>; amount: number };
  const ok: Ok[] = [];

  sheet.forEach((r, i) => {
    const row = i + 2;
    const ref = get(r, REF);
    const fail = (error: string) => errors.push({ row, ref: ref || "—", error });
    if (!ref) return fail(`${REF} is missing`);
    const c = byRef.get(ref);
    if (!c) return fail("AWB not found in open Lost / Damage cases");
    if (!c.isOpen || c.clientCnNumber)
      return fail(c.clientCnNumber ? `Case already closed for OPS (brand CN released ${c.clientCnNumber})` : "Case already closed");
    if (!allowedDispositions(actor.role, factsOf(c)).includes(DISPOSITION[action]))
      return fail(c.source === "API" ? "API-marked case – view only, cannot be updated" : "OPS-marked case – Accounts can only add follow-ups");
    if (seen.has(`${c._id}|${action === "CN_RECEIVED" ? get(r, "CN No.").toLowerCase() : "x"}`)) return fail("AWB appears twice in the sheet");
    seen.add(`${c._id}|${action === "CN_RECEIVED" ? get(r, "CN No.").toLowerCase() : "x"}`);

    const file = get(r, ATT);
    if (file) {
      if (!zip) return fail(`ZIP not uploaded (expected ${file})`);
      if (!zip.has(file.toLowerCase())) return fail(`CN document not found in ZIP (expected ${file})`);
    }
    let amount = 0;
    if (action === "CN_RECEIVED") {
      const no = get(r, "CN No.");
      if (!no) return fail("CN No. is missing");
      if (usedBy.has(no.toLowerCase()))
        return fail(usedBy.get(no.toLowerCase()) === c.courier ? `CN No. ${no} is already recorded` : `CN No. ${no} already recorded for a different courier's case`);
      const prev = cnCourier.get(no.toLowerCase());
      if (prev && prev !== c.courier) return fail(`CN No. ${no} is used for different couriers in this sheet`);
      cnCourier.set(no.toLowerCase(), c.courier);
      if (Number.isNaN(new Date(get(r, "CN Date")).getTime()) || !get(r, "CN Date")) return fail("CN Date is missing or not a date (use YYYY-MM-DD)");
      amount = Number(get(r, "CN Amount").replace(/[₹,\s]/g, ""));
      if (!(amount > 0)) return fail("CN Amount is missing or not a number");
      if (round2(amount) > round2(c.courierLiability)) return fail(`CN amount ${inrText(amount)} is more than claim amount ${inrText(c.courierLiability)}`);
      if (round2(amount) < round2(c.courierLiability) && !get(r, "Short-payment reason")) return fail("Partial CN without short-payment reason");
      if (!file && process.env.REQUIRE_CN_PROOF !== "false") return fail("CN document missing (fill the Attachment file name)");
    }
    if (action === "CN_REJECTED" && !get(r, "Rejection reason")) return fail("Rejection reason is missing");
    ok.push({ row, c, r, amount });
  });

  // Group the valid rows into one update each: one CN per CN No.; otherwise by courier + remarks + file.
  const groups = new Map<string, BulkGroup>();
  for (const o of ok) {
    const remarks = get(o.r, "Remarks") || undefined;
    const file = get(o.r, ATT) || undefined;
    if (action === "CN_RECEIVED") {
      const no = get(o.r, "CN No.");
      const g = groups.get(no.toLowerCase()) ?? { rows: [], courier: o.c.courier, caseIds: [], disposition: "CN_RECEIVED" as const, remarks, file, cn: { cnNumber: no, cnDate: get(o.r, "CN Date"), totalAmount: 0, lines: [] } };
      g.rows.push(o.row);
      g.caseIds.push(o.c._id);
      g.cn!.lines.push({ caseId: o.c._id, amount: o.amount, shortReason: get(o.r, "Short-payment reason") || undefined });
      g.cn!.totalAmount = round2(g.cn!.totalAmount + o.amount);
      groups.set(no.toLowerCase(), g);
    } else {
      const rejection = action === "CN_REJECTED" ? get(o.r, "Rejection reason") : undefined;
      const key = `${o.c.courier}|${remarks ?? ""}|${file ?? ""}|${rejection ?? ""}`;
      const g = groups.get(key) ?? { rows: [], courier: o.c.courier, caseIds: [], disposition: DISPOSITION[action], remarks, file, rejection };
      g.rows.push(o.row);
      g.caseIds.push(o.c._id);
      groups.set(key, g);
    }
  }
  return {
    total: sheet.length,
    ready: ok.length,
    errors,
    cnValue: round2(ok.reduce((s, o) => s + o.amount, 0)),
    zipFiles: zip?.size ?? 0,
    groups: [...groups.values()],
  };
}

export async function applyBulk(actor: Actor, result: BulkResult, zip: Map<string, JSZip.JSZipObject>) {
  const failed: { row: number; ref: string; error: string }[] = [];
  let applied = 0;
  for (const g of result.groups) {
    try {
      const attachments: { url: string; name: string; size: number; contentType?: string }[] = [];
      if (g.file) {
        const entry = zip.get(g.file.toLowerCase());
        if (!entry) throw badRequest(`Document ${g.file} not found in the ZIP`);
        const data = Buffer.from(await entry.async("uint8array"));
        const ext = g.file.split(".").pop()?.toLowerCase();
        const contentType = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "application/octet-stream";
        const blob = await put(`ld/${Date.now()}-${g.file}`, data, { access: "public", addRandomSuffix: true, contentType });
        attachments.push({ url: blob.url, name: g.file, size: data.length, contentType });
      }
      await applyDisposition(actor, {
        caseIds: g.caseIds, disposition: g.disposition, remarks: g.remarks, attachments,
        cn: g.cn, rejectionReason: g.rejection,
      });
      applied += g.caseIds.length;
    } catch (e) {
      const msg = e instanceof HttpError ? e.message : (e as Error).message || "Could not apply";
      for (const row of g.rows) failed.push({ row, ref: "", error: msg });
    }
  }
  return { applied, failed };
}
