// Shared domain types. All amounts are in rupees, excluding GST.

export const ROLES = ["OPS", "ACCOUNTS", "MANAGEMENT", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const CASE_TYPES = ["LOST", "DAMAGED"] as const;
export type CaseType = (typeof CASE_TYPES)[number];

/** API = marked by the courier's API (owned by Accounts). MANUAL = marked by OPS. */
export const CASE_SOURCES = ["API", "MANUAL"] as const;
export type CaseSource = (typeof CASE_SOURCES)[number];

export const CASE_STATUSES = [
  "MARKED", // case created (by API or OPS)
  "CLAIM_RAISED", // claim sent to courier
  "FOLLOW_UP", // chasing courier
  "ESCALATED", // auto or manual escalation, with management
  "COURIER_REJECTED", // courier refused the claim
  "COURIER_CN_RECEIVED", // courier CN recorded against this AWB, release unlocked
  "PENDING_APPROVAL", // release waiting on management
  "APPROVED_FOR_RELEASE", // management approved a release without a courier CN
  "CLIENT_CN_RELEASED", // brand CN issued
  "CLOSED", // reconciled, found/delivered, or closed by an SD decision
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** What OPS (or Accounts on API cases) can record from the Update status panel. */
export const DISPOSITIONS = ["CLAIM_SENT", "FOLLOW_UP", "CN_RECEIVED", "CN_REJECTED", "FOUND", "ESCALATE"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const SETTLEMENT_MODES = ["BANK_TRANSFER", "FREIGHT_ADJUSTMENT"] as const;
export type SettlementMode = (typeof SETTLEMENT_MODES)[number];

export type SettlementState = "UNSETTLED" | "PARTIAL" | "SETTLED";

export const APPROVAL_REASONS = ["NO_COURIER_CN", "ABOVE_BRAND_LIABILITY", "STOP_CLAIM", "NO_RESPONSE"] as const;
export type ApprovalReason = (typeof APPROVAL_REASONS)[number];

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "SENT_BACK";

/** APPROVAL = Accounts asks to release outside the normal rule. ESCALATION = OPS/Accounts/system asks management to decide. */
export type ApprovalKind = "APPROVAL" | "ESCALATION";

export const SHORT_PAYMENT_REASONS = [
  "Courier liability cap applied",
  "Depreciation applied",
  "Partial damage accepted",
  "Weight / value dispute",
  "Other",
] as const;

export const EXCEPTION_TYPES = [
  "Courier rejected – no CN",
  "Claim filed after courier window",
  "Courier not responding",
  "Client L&D agreement overrides courier terms",
] as const;

export const ESCALATION_TYPES = ["Stop claim – SD absorbs", "High-value case"] as const;

export interface Actor {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** Who did something and when. Stored on every action ("marked by" etc.). */
export interface Stamp {
  userId: string;
  name: string;
  role: Role | "SYSTEM";
  at: Date;
}
