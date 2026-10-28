import type { CaseSource, CaseStatus, CaseType, Stamp } from "@/lib/types";
import type { Attachment } from "./shared";

/** One dispute case per AWB (table: cases). Amounts are rupees excluding GST. */
export interface CaseDoc {
  caseNo: string; // LD-2026-004812
  awb: string;
  orderId?: string | null;
  client: string; // brand
  courier: string;
  type: CaseType;
  source: CaseSource;
  status: CaseStatus;
  ticketStatus?: string | null;
  claimRef?: string | null;

  // Shipment
  product?: string | null;
  pickedUpAt?: Date | null;
  lastScan?: string | null;
  markingReason?: string | null;
  courierRemark?: string | null;

  itemValue: number;
  clientLiability: number; // brand liability = default release amount
  courierLiability: number; // claimed from the courier (contract)
  clientLiabilityCap?: number | null;
  courierLiabilityCap?: number | null;

  // Denormalised for fast lists and dashboard; source of truth is courier_cns / client_cns.
  courierCnAmount: number;
  courierCnNumbers: string[];
  clientCnAmount: number;
  clientCnNumber?: string | null;
  sdGap: number;

  // Claim follow-up
  claimRaisedAt?: Date | null;
  nextFollowUpAt?: Date | null;
  followUpCount: number;
  rejectedAt?: Date | null;
  rejectionNote?: string | null;
  returnedToOps: boolean;
  returnReason?: string | null;
  releaseApproved: boolean; // management approved a release without a courier CN
  approvalRef?: string | null;
  committedBeforeCn: boolean; // brand paid before the courier CN arrived
  closeReason?: string | null;

  isOpen: boolean;
  marked: Stamp; // "marked by" is shown on every screen
  markedAt: Date;
  lastUpdate?: Stamp | null;
  courierCnRecorded?: Stamp | null;
  courierCnRecordedAt?: Date | null;
  released?: Stamp | null;
  releasedAt?: Date | null;
  escalatedAt?: Date | null;
  closed?: Stamp | null;

  remarks?: string | null;
  evidence: Attachment[];
}
