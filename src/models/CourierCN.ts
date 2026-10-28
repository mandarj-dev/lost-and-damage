import type { SettlementMode, SettlementState, Stamp } from "@/lib/types";
import type { Attachment } from "./shared";

export interface CourierCNLine {
  caseId: string;
  awb: string;
  amount: number;
  claimed?: number; // what was claimed for this AWB
  shortReason?: string; // required when the CN is below the claim
}

/**
 * A credit note issued by a courier (table: courier_cns). A consolidated CN covering
 * several AWBs is split into one line per AWB. CN numbers are unique.
 * Settlement (money actually received) is tracked separately in settlements.
 */
export interface CourierCNDoc {
  cnNumber: string;
  courier: string;
  cnDate: Date;
  totalAmount: number;
  lines: CourierCNLine[];
  document?: Attachment | null; // first CN document (kept for the old screens)
  recorded: Stamp;
  settledAmount: number;
  settlementState: SettlementState;
  expectedMode?: SettlementMode | null;
  expectedMonth?: string | null; // YYYY-MM for a freight-bill adjustment
  chasedCount: number;
  createdAt: Date;
}
