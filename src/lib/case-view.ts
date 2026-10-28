// Presentation helpers shared by every screen: ticket chips, claim windows, timeline labels.
// Pure functions: dates may arrive as Date or ISO string.

import { fmtDayShort } from "./dates";
import { addDays, CLAIM_WINDOW_DAYS, daysBetween, RECONTEST_DAYS, type CaseFacts } from "./rules";
import type { CaseDoc, TimelineEventDoc } from "@/models";

export type Tone = "grey" | "amber" | "blue" | "red" | "purple" | "teal" | "green" | "dark";

export interface Chip {
  label: string;
  tone: Tone;
  sub?: string;
  subTone?: "red" | "orange" | "muted";
}

/** One case as the list tables and action panels see it. Plain data: safe to pass to client components. */
export interface CaseRow {
  id: string;
  caseNo: string;
  awb: string;
  orderId: string | null;
  client: string;
  courier: string;
  type: "LOST" | "DAMAGED";
  source: "API" | "MANUAL";
  status: string;
  isOpen: boolean;
  markedAt: string;
  markedBy: string;
  markedByRole: string;
  ageDays: number;
  itemValue: number;
  clientLiability: number;
  courierLiability: number;
  courierCnAmount: number;
  sdGap: number;
  returnedToOps: boolean;
  releaseApproved: boolean;
  committedBeforeCn: boolean;
  duesAmount: number;
  duesAgeDays: number;
  chip: Chip;
  courierCn: { number: string; date: string; by: string; byRole: string; settlement: string; settled: number; total: number } | null;
  clientCn: { number: string; date: string | null; amount: number } | null;
  approval: { ref: string | null; type: string | null; amount: number; since: string; by: string; kind: string } | null;
  lastAction: { label: string; at: string; by: string; role: string } | null;
}

/** The facts the pure rules need, taken from a list row. */
export const factsOfRow = (r: CaseRow): CaseFacts => ({
  source: r.source,
  status: r.status as CaseFacts["status"],
  isOpen: r.isOpen,
  itemValue: r.itemValue,
  clientLiability: r.clientLiability,
  courierCnAmount: r.courierCnAmount,
  clientCnReleased: !!r.clientCn,
  releaseApproved: r.releaseApproved,
  returnedToOps: r.returnedToOps,
  committedBeforeCn: r.committedBeforeCn,
});

export const shortDate = (d?: Date | string | null) =>
  d ? fmtDayShort(d) : "—";

type CaseDates = Pick<CaseDoc, "pickedUpAt" | "markedAt">;

/** Days left in the courier claim window (30 days from pickup, else from marking). Negative = closed. */
export function claimWindowDaysLeft(c: CaseDates, now = new Date()) {
  return CLAIM_WINDOW_DAYS - daysBetween(c.pickedUpAt ?? c.markedAt, now);
}

type ChipCase = Pick<
  CaseDoc,
  | "status" | "isOpen" | "clientCnNumber" | "closeReason" | "returnedToOps" | "returnReason" | "releaseApproved"
  | "courierCnAmount" | "courierLiability" | "courierCnRecordedAt" | "escalatedAt" | "rejectedAt" | "nextFollowUpAt"
  | "claimRaisedAt" | "pickedUpAt" | "markedAt" | "releasedAt" | "committedBeforeCn"
>;

/** The "Ticket status" chip and its sub-line, as shown in the case lists. */
export function ticketChip(c: ChipCase, now = new Date()): Chip {
  if (c.clientCnNumber && !(c.committedBeforeCn && (c.courierCnAmount ?? 0) <= 0))
    return { label: "Brand CN released", tone: "green", sub: c.releasedAt ? shortDate(c.releasedAt) : undefined };
  if (!c.isOpen) {
    if (c.closeReason === "FOUND") return { label: "Found / delivered", tone: "grey", sub: "Closed, no liability" };
    if (c.closeReason === "SD_DECISION_NO_PAYOUT") return { label: "Closed · SD decision", tone: "grey", sub: "No payout to brand" };
    return { label: "Closed", tone: "grey" };
  }
  if (c.returnedToOps) return { label: "Returned by Accounts", tone: "red", sub: c.returnReason ?? undefined, subTone: "red" };
  if (c.status === "PENDING_APPROVAL") return { label: "With management", tone: "purple", sub: "Approval pending" };
  if (!c.clientCnNumber && (c.status === "APPROVED_FOR_RELEASE" || c.releaseApproved))
    return { label: "Approved", tone: "green", sub: "Ready to release" };
  if ((c.courierCnAmount ?? 0) > 0) {
    const partial = c.courierCnAmount < c.courierLiability;
    const waiting = c.courierCnRecordedAt ? daysBetween(c.courierCnRecordedAt, now) : 0;
    return {
      label: partial ? "Partial CN" : "CN received",
      tone: partial ? "teal" : "green",
      sub: `Waiting ${waiting} d`,
      subTone: waiting > 7 ? "red" : "muted",
    };
  }
  switch (c.status) {
    case "ESCALATED":
      return { label: "Escalated", tone: "purple", sub: `With management · ${c.escalatedAt ? daysBetween(c.escalatedAt, now) : 0} d` };
    case "COURIER_REJECTED":
      return { label: "CN rejected", tone: "red", sub: `Re-contest by ${shortDate(addDays(c.rejectedAt ?? now, RECONTEST_DAYS))}` };
    case "FOLLOW_UP":
      return { label: "Follow-up", tone: "amber", sub: `Next follow-up ${shortDate(c.nextFollowUpAt)}` };
    case "CLAIM_RAISED":
      return { label: "Claim raised", tone: "blue", sub: `Filed ${shortDate(c.claimRaisedAt)}` };
    default: {
      const left = claimWindowDaysLeft(c, now);
      return {
        label: "Open",
        tone: "grey",
        sub: left >= 0 ? `Claim window: ${left} day${left === 1 ? "" : "s"} left` : "Claim window closed",
        subTone: left <= 3 ? "red" : "muted",
      };
    }
  }
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

export type DotTone = "brown" | "red" | "blue" | "dark" | "green" | "purple";

/** Title, dot colour and optional chip for a timeline event. */
export function timelineMeta(ev: Pick<TimelineEventDoc, "action" | "data">): { title: string; dot: DotTone; chip?: { label: string; tone: Tone } } {
  const d = (ev.data ?? {}) as Record<string, unknown>;
  switch (ev.action) {
    case "MARKED":
      return { title: `Marked ${d.type === "DAMAGED" ? "damaged" : "lost"} (${d.source === "API" ? "API" : "manual"})`, dot: "dark" };
    case "CLAIM_SENT":
      return { title: "Claim email sent to courier", dot: "blue" };
    case "FOLLOW_UP":
      return { title: typeof d.n === "number" ? `Follow-up sent (${ordinal(d.n)})` : "Follow-up sent", dot: "brown" };
    case "COURIER_CN_RECORDED":
      return { title: d.partial ? "Courier CN received (partial)" : "Courier CN received", dot: "green" };
    case "CN_REJECTED":
      return { title: "Courier rejected the claim", dot: "red" };
    case "CLOSED_FOUND":
      return { title: "Shipment found / delivered / RTO", dot: "dark" };
    case "ESCALATED":
      return { title: "Escalated to management", dot: "purple" };
    case "AUTO_ESCALATED":
      return { title: "Auto-escalated: no courier CN in 15 days", dot: "purple" };
    case "APPROVAL_REQUESTED": {
      const reasons = Array.isArray(d.reasons) ? (d.reasons as string[]) : [];
      return {
        title: reasons.includes("NO_COURIER_CN") ? "Exception requested: release without courier CN" : "Release above brand liability requested",
        dot: "purple",
      };
    }
    case "APPROVAL_APPROVED":
      return { title: "Approved by management", dot: "green" };
    case "APPROVAL_REJECTED":
      return { title: "Rejected by management", dot: "red" };
    case "APPROVAL_SENT_BACK":
      return { title: "Sent back for information", dot: "brown" };
    case "BRAND_CN_RELEASED":
      return d.beforeCn
        ? { title: "Brand payout committed", dot: "red", chip: { label: "Committed before CN", tone: "red" } }
        : { title: "Brand CN released", dot: "green" };
    case "COURIER_SETTLEMENT":
      return { title: "Courier settlement recorded", dot: "green" };
    case "CLOSED":
      return { title: "Case closed", dot: "dark" };
    case "RETURNED_TO_OPS":
      return { title: "Returned to OPS", dot: "red" };
    case "RESUBMITTED":
      return { title: "Resubmitted to Accounts", dot: "blue" };
    case "COMMENT":
      return { title: "Internal note", dot: "dark" };
    default:
      return { title: ev.action.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), dot: "dark" };
  }
}

/** Short role label used in stamps: "Priya M. (OPS)". */
export const roleLabel = (r?: string | null) =>
  r === "OPS" ? "OPS" : r === "ACCOUNTS" ? "Accounts" : r === "MANAGEMENT" ? "Management" : r === "SYSTEM" ? "System" : r === "ADMIN" ? "Admin" : (r ?? "");

export const stampLabel = (s?: { name: string; role: string } | null) =>
  s ? (s.role === "SYSTEM" ? "System" : `${s.name} (${roleLabel(s.role)})`) : "—";

export const fileKind = (name: string) => {
  const ext = name.split(".").pop()?.toUpperCase() ?? "FILE";
  return ext === "JPG" || ext === "JPEG" ? "JPG" : ext;
};
