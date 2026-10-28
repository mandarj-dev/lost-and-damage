// Client-safe description of the bulk-update templates (the server logic lives in bulk.ts).

export const BULK_ACTIONS = ["CN_RECEIVED", "FOLLOW_UP", "CLAIM_SENT", "CN_REJECTED"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export const BULK_LABEL: Record<BulkAction, string> = {
  CN_RECEIVED: "CN received",
  FOLLOW_UP: "Follow-up sent",
  CLAIM_SENT: "Claim email sent",
  CN_REJECTED: "CN rejected",
};

export const BULK_REF = "AWB / Order no.";
export const BULK_ATT = "Attachment file name";

/** [column, required] per action. */
export const BULK_COLUMNS: Record<BulkAction, [string, boolean][]> = {
  CN_RECEIVED: [[BULK_REF, true], ["CN No.", true], ["CN Date", true], ["CN Amount", true], ["Short-payment reason", false], [BULK_ATT, false], ["Remarks", false]],
  FOLLOW_UP: [[BULK_REF, true], ["Remarks", false], [BULK_ATT, false]],
  CLAIM_SENT: [[BULK_REF, true], ["Remarks", false], [BULK_ATT, false]],
  CN_REJECTED: [[BULK_REF, true], ["Rejection reason", true], ["Remarks", false], [BULK_ATT, false]],
};

export const BULK_HELP: Record<BulkAction, string> = {
  CN_RECEIVED: "Repeat the same CN No. on several rows for a consolidated CN. Upload CN PDFs as one ZIP; file names must match the attachment column.",
  FOLLOW_UP: "One row per AWB. Rows with the same remarks and attachment are recorded together.",
  CLAIM_SENT: "One row per AWB. Attach the claim email or invoice through the ZIP if you have it.",
  CN_REJECTED: "One row per AWB with the reason the courier gave.",
};
