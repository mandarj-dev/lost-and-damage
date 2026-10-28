// Business rules for Lost & Damage disputes.
// Pure functions only (no DB access) so they can be unit tested and reused by the UI.

import type {
  Actor,
  ApprovalReason,
  CaseSource,
  CaseStatus,
  Disposition,
  Role,
  SettlementState,
} from "./types";

export const ESCALATE_AFTER_DAYS = Number(process.env.ESCALATE_AFTER_DAYS ?? 15);
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;

/** Courier agreement terms shown on the case screens. */
export const CLAIM_WINDOW_DAYS = 30; // claim must be filed within 30 days of pickup
export const CN_TAT_DAYS = 21; // courier releases the CN within 21 days of the claim
export const FOLLOW_UP_AFTER_DAYS = 3; // default gap between follow-ups
export const RECONTEST_DAYS = 14; // time to re-contest a rejected claim
export const DUES_WARN_DAYS = 30; // client receivables older than this raise a warning

export const DAY_MS = 24 * 60 * 60 * 1000;
export const addDays = (d: Date | string, n: number) => new Date(new Date(d).getTime() + n * DAY_MS);
export const daysBetween = (from: Date | string, to: Date | string = new Date()) =>
  Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS));

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Minimal view of a case that the rules need. */
export interface CaseFacts {
  source: CaseSource;
  status: CaseStatus;
  isOpen: boolean;
  itemValue: number;
  clientLiability: number; // brand liability, the default release amount
  courierCnAmount: number; // sum of courier CN lines recorded against this AWB (0 = none)
  clientCnReleased: boolean;
  releaseApproved?: boolean; // management approved a release without a courier CN
  committedBeforeCn?: boolean; // brand was paid before the courier CN arrived
  returnedToOps?: boolean; // Accounts sent the case back to OPS
}

// ---------------------------------------------------------------------------
// Ownership and permissions
// ---------------------------------------------------------------------------

/** Manual cases belong to OPS, API-marked cases belong to Accounts. */
export function ownerOf(source: CaseSource): Extract<Role, "OPS" | "ACCOUNTS"> {
  return source === "MANUAL" ? "OPS" : "ACCOUNTS";
}

const isAdmin = (role: Role) => role === "ADMIN";

/**
 * What a role may record on a case from the Update status panel.
 * Owners can do everything. Accounts can only add follow-ups on OPS-marked cases.
 */
/** Brand already paid but the courier CN is still missing: OPS keeps chasing it. */
export const inExposure = (c: Pick<CaseFacts, "clientCnReleased" | "committedBeforeCn" | "courierCnAmount">) =>
  c.clientCnReleased && !!c.committedBeforeCn && c.courierCnAmount <= 0;

export function allowedDispositions(role: Role, c: CaseFacts): Disposition[] {
  if (!c.isOpen || (c.clientCnReleased && !inExposure(c))) return [];
  const all: Disposition[] = ["CLAIM_SENT", "FOLLOW_UP", "CN_RECEIVED", "CN_REJECTED", "FOUND", "ESCALATE"];
  if (isAdmin(role) || role === ownerOf(c.source)) return all;
  if (role === "ACCOUNTS" && c.source === "MANUAL") return ["FOLLOW_UP"];
  return [];
}

/** Can this role change anything on the case (status, follow-up) from the list or detail screen? */
export function canUpdateFollowUp(role: Role, c: CaseFacts): boolean {
  return allowedDispositions(role, c).length > 0;
}

/** Who records the courier CN: OPS on manual cases, Accounts on API cases. */
export function canRecordCourierCn(role: Role, c: CaseFacts): boolean {
  if (!c.isOpen || (c.clientCnReleased && !inExposure(c))) return false;
  return isAdmin(role) || role === ownerOf(c.source);
}

/** Accounts may add notes on any open case; on OPS cases that is all they can do until the CN is in. */
export function canComment(_role: Role, c: CaseFacts): boolean {
  return c.isOpen;
}

/** Only Accounts (or Admin) can release a brand CN. Whether it is *allowed* is evaluateRelease. */
export function canInitiateRelease(role: Role): boolean {
  return role === "ACCOUNTS" || isAdmin(role);
}

export function canDecideApproval(role: Role): boolean {
  return role === "MANAGEMENT" || isAdmin(role);
}

export function canRecordSettlement(role: Role): boolean {
  return role === "ACCOUNTS" || isAdmin(role);
}

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

/** SD gap = what SD pays the brand minus what the courier credits SD. Never negative. */
export function sdGap(releaseAmount: number, courierCnAmount: number): number {
  return round2(Math.max(0, releaseAmount - courierCnAmount));
}

export interface ReleaseCheck {
  /** The release can go ahead right now. */
  allowed: boolean;
  /** Management approval is required (and not yet in hand). */
  needsApproval: boolean;
  approvalReasons: ApprovalReason[];
  /** Hard stops that approval cannot override. */
  blockers: string[];
  /** Shown to the user but never block (e.g. client dues). */
  warnings: string[];
  sdGap: number;
}

export interface ReleaseInput {
  amount: number;
  /** An APPROVED approval for this case covering at least `amount`, if any. */
  approvedAmount?: number | null;
  clientOutstandingDues?: number;
}

/**
 * Decide whether Accounts can release a brand CN for `amount`.
 *  - Default amount is brand liability.
 *  - Release is locked until the courier CN is recorded, unless management approved an
 *    exception (then it is released as approved, and SD absorbs the whole amount).
 *  - Releasing more than brand liability needs management approval (ABOVE_BRAND_LIABILITY).
 *  - Client dues are a warning only.
 */
export function evaluateRelease(c: CaseFacts, input: ReleaseInput): ReleaseCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const reasons: ApprovalReason[] = [];
  const amount = round2(input.amount);
  const covered = input.approvedAmount != null && input.approvedAmount >= amount;

  if (!c.isOpen) blockers.push("Case is closed.");
  if (c.clientCnReleased) blockers.push("Brand CN already released for this AWB.");
  if (!(amount > 0)) blockers.push("Release amount must be greater than zero.");
  if (c.returnedToOps) blockers.push("Case was returned to OPS and is waiting for them to resubmit.");
  if (c.courierCnAmount <= 0 && !(c.releaseApproved && covered))
    blockers.push("Release is locked until the courier CN is recorded. Request an exception for management approval.");

  if (amount > c.clientLiability) reasons.push("ABOVE_BRAND_LIABILITY");

  if ((input.clientOutstandingDues ?? 0) > 0)
    warnings.push(
      `Client has outstanding dues of ₹${round2(input.clientOutstandingDues!).toLocaleString("en-IN")}.`,
    );

  const needsApproval = reasons.length > 0 && !covered;

  return {
    allowed: blockers.length === 0 && !needsApproval,
    needsApproval: blockers.length === 0 && needsApproval,
    approvalReasons: reasons,
    blockers,
    warnings,
    sdGap: sdGap(amount, c.courierCnAmount),
  };
}

// ---------------------------------------------------------------------------
// Courier CN and settlement
// ---------------------------------------------------------------------------

export interface CnLine {
  awb: string;
  amount: number;
}

/** A consolidated courier CN must be split per AWB; lines must add up to the CN total. */
export function validateCnSplit(total: number, lines: CnLine[]): string[] {
  const errors: string[] = [];
  if (lines.length === 0) errors.push("At least one AWB line is required.");
  const seen = new Set<string>();
  for (const l of lines) {
    if (!l.awb?.trim()) errors.push("Every line needs an AWB.");
    if (!(l.amount > 0)) errors.push(`Amount for ${l.awb || "a line"} must be greater than zero.`);
    if (seen.has(l.awb)) errors.push(`AWB ${l.awb} appears twice.`);
    seen.add(l.awb);
  }
  const sum = round2(lines.reduce((s, l) => s + (l.amount || 0), 0));
  if (sum !== round2(total))
    errors.push(`Lines add up to ₹${sum}, but the CN total is ₹${round2(total)}.`);
  return errors;
}

export interface CnLineInput extends CnLine {
  /** Amount claimed from the courier for this AWB. */
  claimed: number;
  shortReason?: string;
}

/** Split rules plus: CN cannot exceed the claim, and a short payment needs a reason. */
export function validateCnLines(total: number, lines: CnLineInput[]): string[] {
  const errors = validateCnSplit(total, lines);
  for (const l of lines) {
    if (round2(l.amount) > round2(l.claimed))
      errors.push(
        `CN amount ₹${round2(l.amount).toLocaleString("en-IN")} is more than claim amount ₹${round2(l.claimed).toLocaleString("en-IN")} (AWB ${l.awb}).`,
      );
    else if (round2(l.amount) < round2(l.claimed) && !l.shortReason?.trim())
      errors.push(`Partial CN without short-payment reason (AWB ${l.awb}).`);
  }
  return errors;
}

/** Confirmed is not received: settlement is tracked separately and may be partial. */
export function settlementState(cnTotal: number, settled: number): SettlementState {
  if (settled <= 0) return "UNSETTLED";
  return round2(settled) >= round2(cnTotal) ? "SETTLED" : "PARTIAL";
}

export function validateSettlement(cnTotal: number, alreadySettled: number, amount: number): string[] {
  const errors: string[] = [];
  if (!(amount > 0)) errors.push("Settlement amount must be greater than zero.");
  const remaining = round2(cnTotal - alreadySettled);
  if (round2(amount) > remaining) errors.push(`Only ₹${remaining} is left to settle on this CN.`);
  return errors;
}

// ---------------------------------------------------------------------------
// Escalation
// ---------------------------------------------------------------------------

export function shouldAutoEscalate(
  c: CaseFacts & { markedAt: Date; escalatedAt?: Date | null },
  now = new Date(),
): boolean {
  if (!c.isOpen || c.escalatedAt) return false;
  if (c.courierCnAmount > 0 || c.clientCnReleased) return false;
  if (c.status === "COURIER_REJECTED") return false;
  return now.getTime() - new Date(c.markedAt).getTime() >= ESCALATE_AFTER_DAYS * DAY_MS;
}

export function stampOf(actor: Actor, at = new Date()) {
  return { userId: actor.id, name: actor.name, role: actor.role, at };
}
