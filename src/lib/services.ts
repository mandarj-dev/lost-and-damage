// Application services: every state change goes through here so rules, audit
// stamps and the timeline are applied the same way from the API, imports and cron.

import { z } from "zod";
import { clockNow } from "./clock";
import { fmtDayShort } from "./dates";
import { connectDB, insert, q, update, withTransaction, type Db } from "./db";
import { badRequest, conflict, forbidden, notFound, HttpError } from "./http";
import {
  addDays,
  allowedDispositions,
  canDecideApproval,
  canInitiateRelease,
  canRecordSettlement,
  daysBetween,
  DUES_WARN_DAYS,
  evaluateRelease,
  FOLLOW_UP_AFTER_DAYS,
  round2,
  settlementState,
  shouldAutoEscalate,
  stampOf,
  validateCnLines,
  validateSettlement,
  type CaseFacts,
} from "./rules";
import {
  CASE_TYPES,
  DISPOSITIONS,
  SETTLEMENT_MODES,
  type Actor,
  type CaseSource,
  type CaseStatus,
  type SettlementMode,
} from "./types";
import type { ApprovalDoc, CaseDoc, ClientCNDoc, ClientDoc, CourierCNDoc, SettlementDoc, WithId } from "@/models";

const SYSTEM = { userId: "system", name: "System", role: "SYSTEM" as const };
type By = ReturnType<typeof stampOf> | (typeof SYSTEM & { at: Date });

export function factsOf(c: CaseDoc): CaseFacts {
  return {
    source: c.source as CaseSource,
    status: c.status as CaseStatus,
    isOpen: c.isOpen ?? true,
    itemValue: c.itemValue,
    clientLiability: c.clientLiability,
    courierCnAmount: c.courierCnAmount ?? 0,
    clientCnReleased: !!c.clientCnNumber,
    releaseApproved: c.releaseApproved,
    returnedToOps: c.returnedToOps,
    committedBeforeCn: c.committedBeforeCn,
  };
}

async function log(
  caseId: string,
  action: string,
  by: By,
  message?: string,
  data?: Record<string, unknown>,
  db?: Db,
  attachments?: AttachmentInput[],
) {
  await insert(
    "timeline_events",
    {
      caseId,
      action,
      by,
      message,
      data,
      attachments: (attachments ?? []).map((a) => ({ ...a, uploadedBy: by })),
      createdAt: by.at,
    },
    db,
  );
}

async function loadCase(id: string, db?: Db) {
  const [c] = await q<WithId<CaseDoc>>("SELECT * FROM cases WHERE id = $1", [id], db);
  if (!c) throw notFound("Case not found");
  return c;
}

/** Load and lock several cases; fails if any is missing. */
async function lockCases(ids: string[], db: Db) {
  const unique = [...new Set(ids)];
  const cases = await q<WithId<CaseDoc>>("SELECT * FROM cases WHERE id = ANY($1::uuid[]) FOR UPDATE", [unique], db);
  if (cases.length !== unique.length) throw notFound("One or more cases were not found");
  return cases;
}

async function nextRef(prefix: string, db?: Db) {
  const [r] = await q<{ n: number }>("SELECT nextval('ld_approval_seq')::int AS n", [], db);
  return `${prefix}-${clockNow().getFullYear()}-${String(r.n).padStart(4, "0")}`;
}

const attachment = z.object({
  url: z.string().url(),
  name: z.string(),
  size: z.number().int().positive().max(10 * 1024 * 1024),
  contentType: z.string().optional(),
});
type AttachmentInput = z.infer<typeof attachment>;

const inrText = (n: number) => `₹${round2(n).toLocaleString("en-IN")}`;

// ---------------------------------------------------------------------------
// Marking (manual by OPS, or API by courier webhook / import)
// ---------------------------------------------------------------------------
export const MarkCaseInput = z.object({
  awb: z.string().trim().min(3),
  orderId: z.string().trim().optional(),
  client: z.string().trim().min(1),
  courier: z.string().trim().min(1),
  type: z.enum(CASE_TYPES),
  product: z.string().trim().optional(),
  pickedUpAt: z.coerce.date().optional(),
  lastScan: z.string().trim().optional(),
  markingReason: z.string().trim().optional(),
  courierRemark: z.string().trim().optional(),
  itemValue: z.coerce.number().nonnegative(),
  clientLiability: z.coerce.number().nonnegative(),
  courierLiability: z.coerce.number().nonnegative().default(0),
  clientLiabilityCap: z.coerce.number().nonnegative().optional(),
  courierLiabilityCap: z.coerce.number().nonnegative().optional(),
  markedAt: z.coerce.date().optional(),
  remarks: z.string().optional(),
  evidence: z.array(attachment).max(5).default([]),
});

export async function markCase(actor: Actor | null, source: CaseSource, raw: unknown) {
  const input = MarkCaseInput.parse(raw);
  if (source === "MANUAL") {
    if (!actor || !["OPS", "ADMIN"].includes(actor.role)) throw forbidden("Only OPS can mark cases manually.");
    if (input.evidence.length === 0 && process.env.REQUIRE_EVIDENCE_ON_MANUAL !== "false")
      throw badRequest("Evidence is required when marking a case manually.");
  }
  await connectDB();
  const at = clockNow();
  const by = actor ? stampOf(actor, at) : { ...SYSTEM, at };
  const duplicate = async () => {
    const [exists] = await q<{ _id: string }>("SELECT id FROM cases WHERE awb = $1", [input.awb]);
    return exists ? conflict(`AWB ${input.awb} already has a case.`, { caseId: exists._id }) : null;
  };
  const dup = await duplicate();
  if (dup) throw dup;

  let doc: WithId<CaseDoc>;
  try {
    doc = await insert<WithId<CaseDoc>>("cases", {
      awb: input.awb,
      orderId: input.orderId,
      client: input.client,
      courier: input.courier,
      type: input.type,
      source,
      status: "MARKED",
      product: input.product,
      pickedUpAt: input.pickedUpAt,
      lastScan: input.lastScan,
      markingReason: input.markingReason,
      courierRemark: input.courierRemark,
      itemValue: round2(input.itemValue),
      clientLiability: round2(input.clientLiability),
      courierLiability: round2(input.courierLiability),
      clientLiabilityCap: input.clientLiabilityCap,
      courierLiabilityCap: input.courierLiabilityCap,
      remarks: input.remarks,
      evidence: input.evidence,
      marked: by,
      markedAt: input.markedAt ?? at,
      lastUpdate: by,
    });
  } catch (e) {
    // Two requests for the same AWB at once: the unique index decides, the loser gets the same 409.
    if ((e as { code?: string })?.code === "23505") {
      const again = await duplicate();
      if (again) throw again;
    }
    throw e;
  }
  const how = source === "API" ? "API" : "manual";
  await log(
    doc._id,
    "MARKED",
    by,
    input.markingReason || input.courierRemark || `Marked ${input.type === "LOST" ? "lost" : "damaged"} (${how})`,
    { type: input.type, source },
    undefined,
    input.evidence,
  );
  return doc;
}

// ---------------------------------------------------------------------------
// Update status: one panel for OPS (manual cases) and Accounts (API cases)
// ---------------------------------------------------------------------------
export const DispositionInput = z.object({
  caseIds: z.array(z.string()).min(1).max(100),
  disposition: z.enum(DISPOSITIONS),
  remarks: z.string().optional(),
  attachments: z.array(attachment).max(5).default([]),
  cn: z
    .object({
      cnNumber: z.string().trim().min(1, "Enter the courier CN number"),
      cnDate: z.coerce.date(),
      totalAmount: z.coerce.number().positive(),
      lines: z
        .array(z.object({ caseId: z.string(), amount: z.coerce.number().nonnegative(), shortReason: z.string().optional() }))
        .min(1),
    })
    .optional(),
  rejectionReason: z.string().optional(),
  escalation: z.object({ type: z.string().min(1), justification: z.string().trim().min(1, "Add a justification") }).optional(),
});

const SETTLEMENT_PREF: Record<string, SettlementMode> = {
  Delhivery: "FREIGHT_ADJUSTMENT",
  "Blue Dart": "BANK_TRANSFER",
  "Ecom Express": "BANK_TRANSFER",
  Xpressbees: "FREIGHT_ADJUSTMENT",
  Shadowfax: "FREIGHT_ADJUSTMENT",
  DTDC: "FREIGHT_ADJUSTMENT",
};

/** How the courier is expected to settle, per its agreement (freight bill adjustment unless noted). */
export const expectedSettlement = (courier: string, at = clockNow()) => {
  const mode = SETTLEMENT_PREF[courier] ?? "FREIGHT_ADJUSTMENT";
  return { mode, month: mode === "FREIGHT_ADJUSTMENT" ? at.toISOString().slice(0, 7) : null };
};

export function courierPosition(c: CaseDoc, at = clockNow()): string {
  if ((c.courierCnAmount ?? 0) > 0 && c.courierCnRecordedAt)
    return `Courier CN ${inrText(c.courierCnAmount)} received on ${fmtDayShort(c.courierCnRecordedAt)}`;
  if (c.rejectedAt) return `Courier rejected the claim on ${fmtDayShort(c.rejectedAt)}`;
  const since = c.claimRaisedAt ?? c.markedAt;
  const days = daysBetween(since, at);
  return c.followUpCount > 0
    ? `No response for ${days} days after ${c.followUpCount} follow-up${c.followUpCount === 1 ? "" : "s"}`
    : `No response for ${days} days; no follow-up recorded`;
}

async function recordCourierCnTx(
  db: Db,
  by: By,
  cases: WithId<CaseDoc>[],
  cn: NonNullable<z.infer<typeof DispositionInput>["cn"]>,
  attachments: AttachmentInput[],
  remarks?: string,
) {
  if (attachments.length === 0 && process.env.REQUIRE_CN_PROOF !== "false") throw badRequest("Attach the courier CN document.");
  const byId = new Map(cases.map((c) => [c._id, c]));
  const lineIds = cn.lines.map((l) => l.caseId);
  if (new Set(lineIds).size !== lineIds.length || lineIds.length !== cases.length || lineIds.some((id) => !byId.has(id)))
    throw badRequest("Enter a CN amount for every selected AWB.");
  const lines = cn.lines.map((l) => {
    const c = byId.get(l.caseId)!;
    return { caseId: c._id, awb: c.awb, amount: round2(l.amount), claimed: c.courierLiability, shortReason: l.shortReason?.trim() || undefined };
  });
  const errors = validateCnLines(cn.totalAmount, lines);
  if (errors.length) throw badRequest(errors[0], errors);

  const [used] = await q<{ n: number }>("SELECT count(*)::int AS n FROM courier_cns WHERE lower(cn_number) = lower($1)", [cn.cnNumber], db);
  if (used.n > 0) throw conflict(`CN number ${cn.cnNumber} is already recorded on another case.`);

  const courier = cases[0].courier;
  const pref = expectedSettlement(courier);
  const row = await insert<WithId<CourierCNDoc>>(
    "courier_cns",
    {
      cnNumber: cn.cnNumber,
      courier,
      cnDate: cn.cnDate,
      totalAmount: round2(cn.totalAmount),
      lines,
      document: attachments[0] ? { ...attachments[0], uploadedBy: by } : undefined,
      recorded: by,
      createdAt: by.at,
      expectedMode: pref.mode,
      expectedMonth: pref.month ?? undefined,
    },
    db,
  );
  for (const l of lines) {
    const c = byId.get(l.caseId)!;
    const partial = l.amount < l.claimed;
    await update(
      "cases",
      c._id,
      {
        courierCnAmount: round2((c.courierCnAmount ?? 0) + l.amount),
        courierCnNumbers: [...(c.courierCnNumbers ?? []), cn.cnNumber],
        sdGap: c.clientCnNumber ? Math.max(0, round2(c.clientCnAmount - ((c.courierCnAmount ?? 0) + l.amount))) : undefined,
        status: c.clientCnNumber ? "CLIENT_CN_RELEASED" : "COURIER_CN_RECEIVED",
        courierCnRecorded: by,
        courierCnRecordedAt: by.at,
        returnedToOps: false,
        lastUpdate: by,
      },
      db,
    );
    if (c.clientCnNumber)
      await q("UPDATE client_cns SET sd_gap = $2 WHERE case_id = $1", [c._id, Math.max(0, round2(c.clientCnAmount - ((c.courierCnAmount ?? 0) + l.amount)))], db);
    await log(
      c._id,
      "COURIER_CN_RECORDED",
      by,
      [`${cn.cnNumber} · ${inrText(l.amount)} of ${inrText(l.claimed)}`, partial ? l.shortReason : null, remarks].filter(Boolean).join(" · "),
      { courierCnId: row._id, amount: l.amount, claimed: l.claimed, partial },
      db,
      attachments,
    );
  }
  return row;
}

export async function applyDisposition(actor: Actor, raw: unknown) {
  const input = DispositionInput.parse(raw);
  await connectDB();
  return withTransaction(async (db) => {
    const cases = await lockCases(input.caseIds, db);
    if (new Set(cases.map((c) => c.courier)).size > 1) throw badRequest("Select cases of one courier at a time.");
    for (const c of cases)
      if (!allowedDispositions(actor.role, factsOf(c)).includes(input.disposition))
        throw forbidden(
          c.source === "MANUAL" && actor.role === "ACCOUNTS"
            ? `AWB ${c.awb} is OPS-marked: Accounts can only add follow-ups until OPS records the courier CN.`
            : c.source === "API"
              ? `AWB ${c.awb} is API-marked and owned by Accounts: OPS can only view it.`
              : `You can't do this on AWB ${c.awb}.`,
        );
    const by = stampOf(actor, clockNow());
    const remarks = input.remarks?.trim() || undefined;

    switch (input.disposition) {
      case "CLAIM_SENT":
        for (const c of cases) {
          await update("cases", c._id, { status: "CLAIM_RAISED", claimRaisedAt: c.claimRaisedAt ?? by.at, returnedToOps: false, lastUpdate: by }, db);
          await log(c._id, "CLAIM_SENT", by, remarks ?? "Claim sent to courier", undefined, db, input.attachments);
        }
        break;
      case "FOLLOW_UP":
        for (const c of cases) {
          const n = (c.followUpCount ?? 0) + 1;
          await update(
            "cases",
            c._id,
            { status: "FOLLOW_UP", followUpCount: n, nextFollowUpAt: addDays(by.at, FOLLOW_UP_AFTER_DAYS), lastUpdate: by },
            db,
          );
          await log(c._id, "FOLLOW_UP", by, remarks, { n }, db, input.attachments);
        }
        break;
      case "CN_RECEIVED": {
        if (!input.cn) throw badRequest("Enter the credit note details.");
        await recordCourierCnTx(db, by, cases, input.cn, input.attachments, remarks);
        break;
      }
      case "CN_REJECTED": {
        const why = input.rejectionReason?.trim() || remarks;
        if (!why) throw badRequest("Add the reason the courier gave.");
        for (const c of cases) {
          await update("cases", c._id, { status: "COURIER_REJECTED", rejectedAt: by.at, rejectionNote: why, lastUpdate: by }, db);
          await log(c._id, "CN_REJECTED", by, why, undefined, db, input.attachments);
        }
        break;
      }
      case "FOUND":
        for (const c of cases) {
          await update("cases", c._id, { isOpen: false, status: "CLOSED", closeReason: "FOUND", closed: by, lastUpdate: by }, db);
          await log(c._id, "CLOSED_FOUND", by, remarks ?? "Shipment found / delivered / RTO: closed with no liability", undefined, db, input.attachments);
        }
        break;
      case "ESCALATE": {
        if (!input.escalation) throw badRequest("Choose what you are escalating and add a justification.");
        for (const c of cases) {
          const [pending] = await q<{ _id: string }>("SELECT id FROM approvals WHERE case_id = $1 AND status = 'PENDING'", [c._id], db);
          if (pending) throw conflict(`AWB ${c.awb} already has a request waiting for management.`);
          const ref = await nextRef("ES", db);
          await insert(
            "approvals",
            {
              ref,
              kind: "ESCALATION",
              caseId: c._id,
              awb: c.awb,
              client: c.client,
              courier: c.courier,
              reasons: ["STOP_CLAIM"],
              exceptionType: input.escalation.type,
              requestedAmount: c.clientLiability,
              clientLiability: c.clientLiability,
              courierCnAmount: c.courierCnAmount,
              sdGap: c.clientLiability,
              justification: input.escalation.justification,
              documents: input.attachments,
              courierPosition: courierPosition(c),
              requested: by,
              createdAt: by.at,
            },
            db,
          );
          await update("cases", c._id, { status: "ESCALATED", escalatedAt: c.escalatedAt ?? by.at, lastUpdate: by }, db);
          await log(c._id, "ESCALATED", by, input.escalation.justification, { type: input.escalation.type, ref }, db, input.attachments);
        }
        break;
      }
    }
    return { updated: cases.length };
  });
}

export async function addComment(actor: Actor, caseId: string, message: string) {
  await connectDB();
  const c = await loadCase(caseId);
  if (!message?.trim()) throw badRequest("Comment is empty.");
  await log(c._id, "COMMENT", stampOf(actor, clockNow()), message.trim());
}

// ---------------------------------------------------------------------------
// Return to OPS / resubmit
// ---------------------------------------------------------------------------
export async function returnToOps(actor: Actor, caseId: string, reason: string) {
  if (actor.role !== "ACCOUNTS" && actor.role !== "ADMIN") throw forbidden("Only Accounts can return a case to OPS.");
  if (!reason?.trim()) throw badRequest("Say what OPS needs to fix.");
  await connectDB();
  const c = await loadCase(caseId);
  if (!c.isOpen || c.clientCnNumber) throw conflict("This case can no longer be returned.");
  if (c.source !== "MANUAL") throw badRequest("API-marked cases are owned by Accounts; only OPS cases can be returned.");
  const by = stampOf(actor, clockNow());
  await update("cases", c._id, { returnedToOps: true, returnReason: reason.trim(), lastUpdate: by });
  await log(c._id, "RETURNED_TO_OPS", by, reason.trim());
}

export async function resubmitToAccounts(actor: Actor, caseId: string, note?: string) {
  await connectDB();
  const c = await loadCase(caseId);
  if (!c.returnedToOps) throw conflict("This case was not returned to OPS.");
  if (actor.role !== "OPS" && actor.role !== "ADMIN") throw forbidden("Only OPS can resubmit a returned case.");
  const by = stampOf(actor, clockNow());
  await update("cases", c._id, { returnedToOps: false, returnReason: null, lastUpdate: by });
  await log(c._id, "RESUBMITTED", by, note?.trim() || "Corrected and resubmitted to Accounts");
}

// ---------------------------------------------------------------------------
// Release brand CN (Accounts): one brand CN can cover several cases of a client
// ---------------------------------------------------------------------------
export const ReleaseInput = z.object({
  items: z
    .array(
      z.object({
        caseId: z.string(),
        amount: z.coerce.number().positive(),
        justification: z.string().optional(), // needed when this case is released above brand liability
      }),
    )
    .min(1)
    .max(100),
  brandCn: z
    .object({
      cnNumber: z.string().trim().min(1, "Enter the brand CN number"),
      cnDate: z.coerce.date(),
      amount: z.coerce.number().positive(),
    })
    .optional(),
  checked: z.boolean().optional(), // "I have checked the courier CN documents"
  attachments: z.array(attachment).max(5).default([]),
  remarks: z.string().optional(),
});

export async function getClient(name: string, db?: Db) {
  const [c] = await q<ClientDoc>("SELECT * FROM clients WHERE name = $1", [name], db);
  return c ?? null;
}

export async function releaseBrandCn(actor: Actor, raw: unknown) {
  if (!canInitiateRelease(actor.role)) throw forbidden("Only Accounts can release a brand CN.");
  const input = ReleaseInput.parse(raw);
  await connectDB();
  return withTransaction(async (db) => {
    const cases = await lockCases(input.items.map((i) => i.caseId), db);
    if (new Set(cases.map((c) => c.client)).size > 1) throw badRequest("Select cases of one client at a time.");
    const client = await getClient(cases[0].client, db);
    const dues = client && client.dues > 0 && client.duesAgeDays >= DUES_WARN_DAYS ? client.dues : 0;
    const byId = new Map(cases.map((c) => [c._id, c]));
    const by = stampOf(actor, clockNow());

    const releasing: { c: WithId<CaseDoc>; amount: number; sdGap: number; approvalId?: string }[] = [];
    const approvalsToRaise: { c: WithId<CaseDoc>; amount: number; justification: string; sdGap: number }[] = [];
    for (const item of input.items) {
      const c = byId.get(item.caseId)!;
      const [approval] = await q<WithId<ApprovalDoc>>(
        "SELECT * FROM approvals WHERE case_id = $1 AND status = 'APPROVED' AND consumed = false ORDER BY created_at DESC LIMIT 1",
        [c._id],
        db,
      );
      const check = evaluateRelease(factsOf(c), {
        amount: item.amount,
        approvedAmount: approval?.requestedAmount ?? null,
        clientOutstandingDues: dues,
      });
      if (check.blockers.length) throw conflict(`AWB ${c.awb}: ${check.blockers[0]}`, check);
      if (check.needsApproval) {
        if (!item.justification?.trim())
          throw badRequest(`AWB ${c.awb} is above brand liability: add the reason for management.`);
        approvalsToRaise.push({ c, amount: round2(item.amount), justification: item.justification.trim(), sdGap: check.sdGap });
      } else releasing.push({ c, amount: round2(item.amount), sdGap: check.sdGap, approvalId: approval?._id });
    }

    let released = 0;
    let releasedAmount = 0;
    if (releasing.length) {
      const cn = input.brandCn;
      if (!cn) throw badRequest("Enter the brand credit note details.");
      if (!input.checked) throw badRequest("Confirm that you have checked the courier CN documents.");
      if (input.attachments.length === 0 && process.env.REQUIRE_CN_PROOF !== "false")
        throw badRequest("Attach the brand credit note.");
      releasedAmount = round2(releasing.reduce((s, r) => s + r.amount, 0));
      if (round2(cn.amount) !== releasedAmount)
        throw badRequest(`Brand CN amount ${inrText(cn.amount)} must equal the amount released now (${inrText(releasedAmount)}).`);
      const [used] = await q<{ n: number }>("SELECT count(*)::int AS n FROM client_cns WHERE lower(cn_number) = lower($1)", [cn.cnNumber], db);
      if (used.n > 0) throw conflict(`Brand CN number ${cn.cnNumber} was already used.`);

      for (const r of releasing) {
        const beforeCn = (r.c.courierCnAmount ?? 0) <= 0;
        await insert<WithId<ClientCNDoc>>(
          "client_cns",
          {
            cnNumber: cn.cnNumber,
            caseId: r.c._id,
            awb: r.c.awb,
            client: r.c.client,
            amount: r.amount,
            cnDate: cn.cnDate,
            cnTotal: releasedAmount,
            courierCnAmountAtRelease: r.c.courierCnAmount,
            sdGap: r.sdGap,
            approvalId: r.approvalId,
            released: by,
            releasedAt: by.at,
            createdAt: by.at,
            documents: input.attachments,
            remarks: input.remarks,
          },
          db,
        );
        // Guard against a concurrent release: only update if still unreleased.
        const updated = await update(
          "cases",
          r.c._id,
          {
            clientCnNumber: cn.cnNumber,
            clientCnAmount: r.amount,
            sdGap: r.sdGap,
            status: "CLIENT_CN_RELEASED",
            released: by,
            releasedAt: by.at,
            committedBeforeCn: beforeCn,
            lastUpdate: by,
          },
          db,
          "client_cn_number IS NULL",
        );
        if (!updated) throw new HttpError(409, `Brand CN was already released for AWB ${r.c.awb}.`);
        if (r.approvalId) await update("approvals", r.approvalId, { consumed: true }, db);
        await log(
          r.c._id,
          "BRAND_CN_RELEASED",
          by,
          [`${cn.cnNumber} · ${inrText(r.amount)} (SD gap ${inrText(r.sdGap)})`, input.remarks?.trim()].filter(Boolean).join(" · "),
          { amount: r.amount, sdGap: r.sdGap, beforeCn, warnings: dues ? [`Client has ${inrText(dues)} outstanding for more than ${DUES_WARN_DAYS} days.`] : [] },
          db,
          input.attachments,
        );
        released++;
      }
      await closeReconciled(releasing.map((r) => r.c._id), by, db);
    }

    const approvalIds: string[] = [];
    for (const a of approvalsToRaise) {
      const [pending] = await q<{ _id: string }>("SELECT id FROM approvals WHERE case_id = $1 AND status = 'PENDING'", [a.c._id], db);
      if (pending) throw conflict(`AWB ${a.c.awb} already has a request waiting for management.`);
      const ref = await nextRef("AP", db);
      const row = await insert<WithId<ApprovalDoc>>(
        "approvals",
        {
          ref,
          kind: "APPROVAL",
          caseId: a.c._id,
          awb: a.c.awb,
          client: a.c.client,
          courier: a.c.courier,
          reasons: ["ABOVE_BRAND_LIABILITY"],
          exceptionType: "Above brand liability",
          requestedAmount: a.amount,
          clientLiability: a.c.clientLiability,
          courierCnAmount: a.c.courierCnAmount,
          sdGap: a.sdGap,
          justification: a.justification,
          documents: input.attachments,
          courierPosition: courierPosition(a.c),
          requested: by,
          createdAt: by.at,
        },
        db,
      );
      await update("cases", a.c._id, { status: "PENDING_APPROVAL", lastUpdate: by }, db);
      await log(a.c._id, "APPROVAL_REQUESTED", by, a.justification, { ref, amount: a.amount, reasons: ["ABOVE_BRAND_LIABILITY"] }, db, input.attachments);
      approvalIds.push(row._id);
    }
    return { released, releasedAmount, sentForApproval: approvalsToRaise.length, approvalIds };
  });
}

// ---------------------------------------------------------------------------
// Release without a courier CN: an exception that management must approve
// ---------------------------------------------------------------------------
export const ExceptionInput = z.object({
  caseId: z.string(),
  exceptionType: z.string().min(1, "Choose the exception type"),
  justification: z.string().trim().min(1, "Explain why SD should pay without a courier CN"),
  proposedAmount: z.coerce.number().positive(),
  approver: z.string().optional(),
  neededBy: z.coerce.date().optional(),
  documents: z.array(attachment).max(5).default([]),
});

export async function requestException(actor: Actor, raw: unknown) {
  if (!canInitiateRelease(actor.role)) throw forbidden("Only Accounts can request a release exception.");
  const input = ExceptionInput.parse(raw);
  if (input.documents.length === 0) throw badRequest("Attach supporting documents (client agreement clause, escalation mail).");
  await connectDB();
  return withTransaction(async (db) => {
    const [c] = await lockCases([input.caseId], db);
    if (!c.isOpen || c.clientCnNumber) throw conflict("This case is already released or closed.");
    if ((c.courierCnAmount ?? 0) > 0) throw conflict("The courier CN is already recorded: release the brand CN normally.");
    const [pending] = await q<{ _id: string }>("SELECT id FROM approvals WHERE case_id = $1 AND status = 'PENDING'", [c._id], db);
    if (pending) throw conflict("A request for this case is already waiting for management.");
    const by = stampOf(actor, clockNow());
    const ref = await nextRef("AP", db);
    const row = await insert<WithId<ApprovalDoc>>(
      "approvals",
      {
        ref,
        kind: "APPROVAL",
        caseId: c._id,
        awb: c.awb,
        client: c.client,
        courier: c.courier,
        reasons: ["NO_COURIER_CN"],
        exceptionType: input.exceptionType,
        requestedAmount: round2(input.proposedAmount),
        clientLiability: c.clientLiability,
        courierCnAmount: 0,
        sdGap: round2(input.proposedAmount),
        justification: input.justification,
        approver: input.approver || "Management – L&D owner",
        neededBy: input.neededBy,
        documents: input.documents,
        courierPosition: courierPosition(c),
        requested: by,
        createdAt: by.at,
      },
      db,
    );
    await update("cases", c._id, { status: "PENDING_APPROVAL", lastUpdate: by }, db);
    await log(c._id, "APPROVAL_REQUESTED", by, input.justification, { ref, amount: input.proposedAmount, reasons: ["NO_COURIER_CN"], type: input.exceptionType }, db, input.documents);
    return row;
  });
}

// ---------------------------------------------------------------------------
// Management decision on an approval or escalation
// ---------------------------------------------------------------------------
export const DecisionInput = z.object({
  decision: z.enum(["APPROVE", "REJECT", "SEND_BACK"]),
  note: z.string().optional(),
});

export async function decideApproval(actor: Actor, approvalId: string, raw: unknown) {
  if (!canDecideApproval(actor.role)) throw forbidden("Only management can decide approvals.");
  const input = DecisionInput.parse(raw);
  if (input.decision !== "APPROVE" && !input.note?.trim())
    throw badRequest(input.decision === "REJECT" ? "Give a reason for rejecting." : "Say what information you need.");
  await connectDB();
  return withTransaction(async (db) => {
    const [a] = await q<WithId<ApprovalDoc>>("SELECT * FROM approvals WHERE id = $1 FOR UPDATE", [approvalId], db);
    if (!a) throw notFound("Approval not found");
    if (a.status !== "PENDING") throw conflict(`Already ${a.status.toLowerCase().replace("_", " ")}.`);
    if (a.requested?.userId === actor.id) throw forbidden("You can't decide your own request.");

    const by = stampOf(actor, clockNow());
    const status = input.decision === "APPROVE" ? "APPROVED" : input.decision === "REJECT" ? "REJECTED" : "SENT_BACK";
    const decided = await update<WithId<ApprovalDoc>>("approvals", a._id, { status, decided: by, decisionNote: input.note?.trim() || undefined }, db, "status = 'PENDING'");
    if (!decided) throw conflict("Already decided.");

    const c = await loadCase(a.caseId, db);
    const noCn = a.reasons.includes("NO_COURIER_CN");
    const escalation = a.kind === "ESCALATION";
    const hasCn = (c.courierCnAmount ?? 0) > 0;
    if (c.isOpen && c.status !== "CLIENT_CN_RELEASED") {
      if (status === "APPROVED") {
        if (noCn || escalation)
          await update("cases", c._id, { releaseApproved: true, approvalRef: a.ref ?? undefined, status: "APPROVED_FOR_RELEASE", lastUpdate: by }, db);
        else await update("cases", c._id, { approvalRef: a.ref ?? undefined, status: "COURIER_CN_RECEIVED", lastUpdate: by }, db);
      } else if (status === "REJECTED" && noCn) {
        // SD decides not to pay the brand without a courier CN.
        await update("cases", c._id, { isOpen: false, status: "CLOSED", closeReason: "SD_DECISION_NO_PAYOUT", closed: by, lastUpdate: by }, db);
      } else {
        await update("cases", c._id, { status: hasCn ? "COURIER_CN_RECEIVED" : "FOLLOW_UP", lastUpdate: by }, db);
      }
    }
    await log(
      a.caseId,
      `APPROVAL_${status}`,
      by,
      input.note?.trim() || undefined,
      { ref: a.ref, amount: a.requestedAmount, type: a.exceptionType, kind: a.kind },
      db,
    );
    return decided;
  });
}

// ---------------------------------------------------------------------------
// Courier settlement: bank transfer or freight-bill adjustment, over one or more CNs
// ---------------------------------------------------------------------------
export const SettlementInput = z
  .object({
    mode: z.enum(SETTLEMENT_MODES),
    freightMonth: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM").optional(),
    freightBillNo: z.string().trim().optional(),
    utr: z.string().trim().optional(),
    amount: z.coerce.number().positive(),
    settledOn: z.coerce.date(),
    items: z.array(z.object({ courierCnId: z.string(), amount: z.coerce.number().positive() })).min(1).max(50),
    proof: z.array(attachment).max(5).default([]),
    remarks: z.string().optional(),
  })
  .refine((v) => (v.mode === "BANK_TRANSFER" ? !!v.utr : !!v.freightMonth && !!v.freightBillNo), {
    message: "Bank transfer needs a UTR; a freight-bill adjustment needs the month and the freight bill number.",
  });

export async function recordSettlement(actor: Actor, raw: unknown) {
  if (!canRecordSettlement(actor.role)) throw forbidden("Only Accounts can record settlements.");
  const input = SettlementInput.parse(raw);
  if (input.proof.length === 0 && process.env.REQUIRE_SETTLEMENT_PROOF !== "false")
    throw badRequest("Attach the proof (bank advice or the courier freight bill).");
  const total = round2(input.items.reduce((s, i) => s + i.amount, 0));
  if (total !== round2(input.amount))
    throw badRequest(`The amounts applied to the CNs (${inrText(total)}) must match the amount settled (${inrText(input.amount)}).`);
  await connectDB();
  return withTransaction(async (db) => {
    const ids = input.items.map((i) => i.courierCnId);
    if (new Set(ids).size !== ids.length) throw badRequest("Each CN can appear once.");
    const cns = await q<WithId<CourierCNDoc>>("SELECT * FROM courier_cns WHERE id = ANY($1::uuid[]) FOR UPDATE", [ids], db);
    if (cns.length !== ids.length) throw notFound("Courier CN not found");
    if (new Set(cns.map((c) => c.courier)).size > 1) throw badRequest("Record one courier at a time.");
    if (input.utr) {
      const [other] = await q<{ n: number }>("SELECT count(*)::int AS n FROM settlements WHERE utr = $1 AND courier <> $2", [input.utr, cns[0].courier], db);
      if (other.n > 0) throw conflict(`UTR ${input.utr} was already recorded for another courier.`);
    }
    const by = stampOf(actor, clockNow());
    const batchId = crypto.randomUUID();
    const byCn = new Map(cns.map((c) => [c._id, c]));
    const touched: string[] = [];
    for (const item of input.items) {
      const cn = byCn.get(item.courierCnId)!;
      const errors = validateSettlement(cn.totalAmount, cn.settledAmount ?? 0, item.amount);
      if (errors.length) throw badRequest(`${cn.cnNumber}: ${errors[0]}`, errors);
      await insert<WithId<SettlementDoc>>(
        "settlements",
        {
          courierCnId: cn._id,
          cnNumber: cn.cnNumber,
          courier: cn.courier,
          mode: input.mode,
          utr: input.utr || undefined,
          adjustmentMonth: input.freightMonth,
          freightInvoiceRef: input.freightBillNo,
          amount: round2(item.amount),
          settledOn: input.settledOn,
          proof: input.proof[0],
          batchId,
          remarks: input.remarks,
          recorded: by,
          createdAt: by.at,
        },
        db,
      );
      const settledAmount = round2((cn.settledAmount ?? 0) + item.amount);
      const state = settlementState(cn.totalAmount, settledAmount);
      await update("courier_cns", cn._id, { settledAmount, settlementState: state }, db);
      const how = input.mode === "BANK_TRANSFER" ? `Bank transfer · UTR ${input.utr}` : `Freight bill ${input.freightBillNo} · ${input.freightMonth}`;
      for (const l of cn.lines) {
        await log(l.caseId, "COURIER_SETTLEMENT", by, `${cn.cnNumber} · ${how} · ${inrText(item.amount)} (${state === "SETTLED" ? "settled" : "part-settled"})`, { settlementBatch: batchId }, db, input.proof);
        touched.push(l.caseId);
      }
    }
    await closeReconciled(touched, by, db);
    return { batchId, cns: cns.length, amount: total };
  });
}

/** Close cases whose brand CN is released and whose courier CNs are all settled. */
async function closeReconciled(caseIds: string[], by: By, db: Db) {
  const ids = [...new Set(caseIds)];
  if (!ids.length) return;
  const cases = await q<WithId<CaseDoc>>(
    "SELECT * FROM cases WHERE id = ANY($1::uuid[]) AND is_open AND client_cn_number IS NOT NULL FOR UPDATE",
    [ids],
    db,
  );
  for (const c of cases) {
    const [open] = await q<{ n: number }>(
      "SELECT count(*)::int AS n FROM courier_cns WHERE lines @> $1::jsonb AND settlement_state <> 'SETTLED'",
      [JSON.stringify([{ caseId: c._id }])],
      db,
    );
    if ((open?.n ?? 0) > 0) continue;
    // A brand paid before any courier CN has nothing to reconcile against yet.
    if ((c.courierCnAmount ?? 0) <= 0) continue;
    await update("cases", c._id, { isOpen: false, status: "CLOSED", closeReason: "RECONCILED", closed: by }, db);
    await log(c._id, "CLOSED", by, "Reconciled: brand CN released and courier CN settled", undefined, db);
  }
}

// ---------------------------------------------------------------------------
// Auto-escalation (Vercel Cron): no courier CN after the escalation window
// ---------------------------------------------------------------------------
export async function runAutoEscalation(now = clockNow()) {
  await connectDB();
  const candidates = await q<WithId<CaseDoc>>(
    `SELECT * FROM cases
     WHERE is_open AND escalated_at IS NULL AND courier_cn_amount <= 0 AND client_cn_number IS NULL
       AND status NOT IN ('COURIER_REJECTED', 'CLIENT_CN_RELEASED', 'PENDING_APPROVAL', 'APPROVED_FOR_RELEASE')`,
  );
  let escalated = 0;
  for (const c of candidates) {
    if (!shouldAutoEscalate({ ...factsOf(c), markedAt: c.markedAt, escalatedAt: c.escalatedAt }, now)) continue;
    const by = { ...SYSTEM, at: now };
    const ref = await nextRef("ES");
    await insert("approvals", {
      ref,
      kind: "ESCALATION",
      caseId: c._id,
      awb: c.awb,
      client: c.client,
      courier: c.courier,
      reasons: ["NO_RESPONSE"],
      exceptionType: "No courier response · 15 days",
      requestedAmount: c.clientLiability,
      clientLiability: c.clientLiability,
      courierCnAmount: 0,
      sdGap: c.clientLiability,
      justification: "No courier CN within the escalation window.",
      courierPosition: courierPosition(c, now),
      requested: by,
      createdAt: by.at,
    });
    await update("cases", c._id, { status: "ESCALATED", escalatedAt: now, lastUpdate: by });
    await log(c._id, "AUTO_ESCALATED", by, "No courier CN within the escalation window", { ref });
    escalated++;
  }
  return { checked: candidates.length, escalated };
}
