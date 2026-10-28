import type { ApprovalKind, ApprovalReason, ApprovalStatus, Role, SettlementMode, Stamp } from "@/lib/types";
import type { Attachment } from "./shared";

/** Credit note SD issues to the brand (table: client_cns). One row per case; one CN number can cover several cases. */
export interface ClientCNDoc {
  cnNumber: string;
  caseId: string;
  awb: string;
  client: string;
  amount: number;
  cnDate?: Date | null;
  cnTotal?: number | null;
  courierCnAmountAtRelease: number;
  sdGap: number;
  approvalId?: string | null;
  released: Stamp;
  releasedAt: Date;
  documents: Attachment[];
  note?: string | null;
  remarks?: string | null;
}

/**
 * Courier actually paying a CN (table: settlements): bank transfer (UTR) or
 * freight-bill adjustment against a month. Many settlements per CN (part-settlement).
 * One recording can cover several CNs of a courier: they share a batchId.
 */
export interface SettlementDoc {
  courierCnId: string;
  cnNumber: string;
  courier: string;
  mode: SettlementMode;
  utr?: string | null;
  adjustmentMonth?: string | null; // e.g. 2026-10
  freightInvoiceRef?: string | null;
  amount: number;
  settledOn: Date;
  proof?: Attachment | null;
  batchId?: string | null;
  remarks?: string | null;
  recorded: Stamp;
}

/** Management sign-off or decision (table: approvals). */
export interface ApprovalDoc {
  ref?: string | null; // AP-2026-0123
  kind: ApprovalKind;
  caseId: string;
  awb: string;
  client?: string | null;
  courier?: string | null;
  reasons: ApprovalReason[];
  exceptionType?: string | null;
  requestedAmount: number;
  clientLiability?: number | null;
  courierCnAmount?: number | null;
  sdGap?: number | null;
  justification: string;
  approver?: string | null;
  neededBy?: Date | null;
  documents: Attachment[];
  courierPosition?: string | null;
  status: ApprovalStatus;
  requested: Stamp;
  decided?: Stamp | null;
  decisionNote?: string | null;
  consumed: boolean; // set once used by a release
  createdAt: Date;
}

/** Append-only audit log per case (table: timeline_events). */
export interface TimelineEventDoc {
  caseId: string;
  action: string;
  by: Stamp;
  message?: string | null;
  data?: Record<string, unknown> | null;
  attachments: Attachment[];
  createdAt: Date;
}

/** Client receivables (table: clients). */
export interface ClientDoc {
  name: string;
  dues: number;
  duesAgeDays: number;
}

/** Mirrors InstaLogix users and their role in this module (table: users). */
export interface UserDoc {
  email: string;
  name: string;
  role: Role;
  active: boolean;
}
