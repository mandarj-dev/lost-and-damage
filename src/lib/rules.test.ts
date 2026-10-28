import { describe, expect, it } from "vitest";
import {
  allowedDispositions,
  canRecordCourierCn,
  evaluateRelease,
  inExposure,
  sdGap,
  settlementState,
  shouldAutoEscalate,
  validateCnLines,
  validateCnSplit,
  validateSettlement,
  type CaseFacts,
} from "./rules";

const base: CaseFacts = {
  source: "MANUAL",
  status: "COURIER_CN_RECEIVED",
  isOpen: true,
  itemValue: 4500,
  clientLiability: 5000,
  courierCnAmount: 3000,
  clientCnReleased: false,
};

describe("ownership", () => {
  it("OPS acts on manual cases, Accounts on API cases; Accounts may only follow up OPS cases", () => {
    expect(allowedDispositions("OPS", base)).toHaveLength(6);
    expect(allowedDispositions("ACCOUNTS", base)).toEqual(["FOLLOW_UP"]);
    const api = { ...base, source: "API" as const };
    expect(allowedDispositions("OPS", api)).toEqual([]);
    expect(allowedDispositions("ACCOUNTS", api)).toHaveLength(6);
    expect(canRecordCourierCn("ACCOUNTS", base)).toBe(false);
    expect(canRecordCourierCn("ACCOUNTS", api)).toBe(true);
  });
  it("nobody acts on closed or released cases", () => {
    expect(allowedDispositions("ADMIN", { ...base, isOpen: false })).toEqual([]);
    expect(allowedDispositions("OPS", { ...base, clientCnReleased: true })).toEqual([]);
  });
  it("OPS keeps chasing a case the brand was paid for before the courier CN arrived", () => {
    const exposed = { ...base, clientCnReleased: true, committedBeforeCn: true, courierCnAmount: 0 };
    expect(inExposure(exposed)).toBe(true);
    expect(allowedDispositions("OPS", exposed)).toHaveLength(6);
    expect(canRecordCourierCn("OPS", exposed)).toBe(true);
    // once the courier CN is in, the case is done for OPS
    expect(allowedDispositions("OPS", { ...exposed, courierCnAmount: 4000 })).toEqual([]);
  });
});

describe("release", () => {
  it("brand liability release with courier CN goes through; SD absorbs the gap", () => {
    // item 4,500 / courier 3,000 / brand 5,000 -> gap 2,000
    const r = evaluateRelease(base, { amount: 5000 });
    expect(r.allowed).toBe(true);
    expect(r.needsApproval).toBe(false);
    expect(r.sdGap).toBe(2000);
  });

  it("is locked without a courier CN, unless management approved an exception", () => {
    const noCn = { ...base, courierCnAmount: 0 };
    const r = evaluateRelease(noCn, { amount: 5000 });
    expect(r.allowed).toBe(false);
    expect(r.blockers[0]).toMatch(/locked/i);
    // approval alone is not enough: the case must carry the approved-release flag
    expect(evaluateRelease(noCn, { amount: 5000, approvedAmount: 5000 }).allowed).toBe(false);
    expect(evaluateRelease({ ...noCn, releaseApproved: true }, { amount: 5000, approvedAmount: 5000 }).allowed).toBe(true);
    expect(evaluateRelease({ ...noCn, releaseApproved: true }, { amount: 5000, approvedAmount: 4000 }).allowed).toBe(false);
  });

  it("needs approval above brand liability; approval must cover the amount", () => {
    expect(evaluateRelease(base, { amount: 5200 }).approvalReasons).toEqual(["ABOVE_BRAND_LIABILITY"]);
    expect(evaluateRelease(base, { amount: 5200 }).needsApproval).toBe(true);
    expect(evaluateRelease(base, { amount: 5200, approvedAmount: 5100 }).allowed).toBe(false);
    expect(evaluateRelease(base, { amount: 5200, approvedAmount: 5200 }).allowed).toBe(true);
  });

  it("client dues warn but do not block", () => {
    const r = evaluateRelease(base, { amount: 5000, clientOutstandingDues: 12000 });
    expect(r.allowed).toBe(true);
    expect(r.warnings.length).toBe(1);
  });

  it("cannot release twice, or while returned to OPS", () => {
    const twice = evaluateRelease({ ...base, clientCnReleased: true }, { amount: 5000, approvedAmount: 9999 });
    expect(twice.allowed).toBe(false);
    expect(twice.blockers.length).toBeGreaterThan(0);
    expect(evaluateRelease({ ...base, returnedToOps: true }, { amount: 5000 }).allowed).toBe(false);
  });

  it("gap is never negative", () => {
    expect(sdGap(2000, 3000)).toBe(0);
  });
});

describe("courier CN and settlement", () => {
  it("consolidated CN lines must add up", () => {
    expect(validateCnSplit(5000, [{ awb: "A1", amount: 3000 }, { awb: "A2", amount: 2000 }])).toEqual([]);
    expect(validateCnSplit(5000, [{ awb: "A1", amount: 3000 }])).toHaveLength(1);
    expect(validateCnSplit(6000, [{ awb: "A1", amount: 3000 }, { awb: "A1", amount: 3000 }])).toHaveLength(1);
  });

  it("a CN cannot exceed the claim, and a short payment needs a reason", () => {
    expect(validateCnLines(4850, [{ awb: "A1", amount: 4850, claimed: 4850 }])).toEqual([]);
    expect(validateCnLines(3000, [{ awb: "A1", amount: 3000, claimed: 4500 }])[0]).toMatch(/short-payment/i);
    expect(validateCnLines(3000, [{ awb: "A1", amount: 3000, claimed: 4500, shortReason: "Courier liability cap applied" }])).toEqual([]);
    expect(validateCnLines(3800, [{ awb: "A1", amount: 3800, claimed: 3450 }])[0]).toMatch(/more than claim/i);
  });

  it("tracks part settlement", () => {
    expect(settlementState(5000, 0)).toBe("UNSETTLED");
    expect(settlementState(5000, 2000)).toBe("PARTIAL");
    expect(settlementState(5000, 5000)).toBe("SETTLED");
    expect(validateSettlement(5000, 2000, 3500)).toHaveLength(1);
    expect(validateSettlement(5000, 2000, 3000)).toEqual([]);
  });
});

describe("escalation", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const open = { ...base, courierCnAmount: 0, status: "FOLLOW_UP" as const };
  it("escalates after 15 days without a courier CN", () => {
    expect(shouldAutoEscalate({ ...open, markedAt: new Date("2026-10-05T00:00:00Z") }, now)).toBe(true);
    expect(shouldAutoEscalate({ ...open, markedAt: new Date("2026-10-10T00:00:00Z") }, now)).toBe(false);
    expect(shouldAutoEscalate({ ...base, markedAt: new Date("2026-09-01T00:00:00Z") }, now)).toBe(false);
  });
});
