// Integration tests: the demo seed plus the main flows, against a real Postgres (see src/test/setup.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, q, withSandbox } from "./db";
import { DEMO_ACTORS, startSandbox } from "./demo";
import {
  accountsKpis, caseIdsByAwb, countCases, getCaseDetail, groupCases, listCaseRows, opsKpis, typeCounts, type ListQuery, type Scope,
} from "./queries";
import { approvalCounts, approvalDetail, listApprovalItems, listSettlementRows, managementDashboard, settlementKpis } from "./reports";
import { applyDisposition, decideApproval, markCase, recordSettlement, releaseBrandCn, requestException, resubmitToAccounts, returnToOps, runAutoEscalation } from "./services";
import type { Actor } from "./types";

const SID = "a1b2c3d4e5f6";
const ops: Actor = DEMO_ACTORS.OPS;
const acc: Actor = DEMO_ACTORS.ACCOUNTS;
const mgmt: Actor = DEMO_ACTORS.MANAGEMENT;
const sb = <T>(fn: () => Promise<T>) => withSandbox(SID, fn);
const doc = { url: "https://example.com/x.pdf", name: "x.pdf", size: 1000, contentType: "application/pdf" };
const id = async (awb: string) => (await caseIdsByAwb([awb])).get(awb)!;
const scoped = (scope: Scope, extra: Partial<ListQuery> = {}): ListQuery => ({ scope, ...extra });
const awbs = async (qy: ListQuery) => (await listCaseRows(qy)).rows.map((r) => r.awb);

beforeAll(async () => {
  await startSandbox(SID);
});
afterAll(async () => {
  await closeDb();
});

describe("demo seed", () => {
  it("creates a realistic spread of cases", () =>
    sb(async () => {
      const [r] = await q<{ n: number; api: number; manual: number }>("SELECT count(*)::int AS n, count(*) FILTER (WHERE source='API')::int AS api, count(*) FILTER (WHERE source='MANUAL')::int AS manual FROM cases");
      expect(r.n).toBeGreaterThanOrEqual(40);
      expect(r.api).toBeGreaterThan(10);
      expect(r.manual).toBeGreaterThan(15);
      const [t] = await q<{ n: number }>("SELECT count(*)::int AS n FROM timeline_events");
      expect(t.n).toBeGreaterThan(100);
    }));

  it("keeps brand-paid-before-CN cases open for OPS, and closes released-with-CN ones", () =>
    sb(async () => {
      const open = await awbs({ ...scoped("open"), page: 1, search: "7834501926,1426653901" });
      expect(open).toContain("7834501926"); // exposure: brand paid, courier CN missing
      expect(open).not.toContain("1426653901"); // brand CN released with CN in hand
      const closed = await awbs({ ...scoped("closed"), search: "7834501926,1426653901" });
      expect(closed).toContain("1426653901");
      expect(closed).not.toContain("7834501926");
    }));

  it("splits unreleased cases cleanly across the Accounts buckets", () =>
    sb(async () => {
      const k = await accountsKpis();
      expect(k.readyN + k.awaitN + k.apprN).toBe(k.issuableOrders);
      expect(k.readyN).toBeGreaterThanOrEqual(8);
      expect(k.awaitN).toBeGreaterThanOrEqual(8);
      expect(k.apprN).toBeGreaterThanOrEqual(3);
      expect(k.unsettledCns).toBeGreaterThanOrEqual(4);
      const ready = await countCases(scoped("ready"));
      expect(ready).toBe(k.readyN);
    }));
});

describe("lists, groups and KPIs", () => {
  it("renders every list and group view for OPS and Accounts", () =>
    sb(async () => {
      for (const scope of ["open", "closed", "ready", "await", "approval", "released"] as Scope[]) {
        const l = await listCaseRows(scoped(scope));
        expect(l.total).toBeGreaterThanOrEqual(0);
        for (const by of ["courier", "client"] as const) expect(Array.isArray(await groupCases(scoped(scope), by))).toBe(true);
        const t = await typeCounts(scoped(scope));
        expect(t.all).toBe(t.lost + t.damage);
      }
      const k = await opsKpis();
      expect(k.open).toBeGreaterThan(10);
      expect(k.closed).toBeGreaterThan(3);
    }));

  it("filters by search, type, ticket status, dues and date", () =>
    sb(async () => {
      expect(await awbs({ ...scoped("open"), search: "PP-7731, 9920114563" })).toEqual(expect.arrayContaining(["8812004417", "9920114563"]));
      expect((await listCaseRows({ ...scoped("open"), type: "DAMAGED" })).rows.every((r) => r.type === "DAMAGED")).toBe(true);
      expect((await listCaseRows({ ...scoped("open"), ticket: "rejected" })).rows.every((r) => r.status === "COURIER_REJECTED")).toBe(true);
      const dues = await listCaseRows({ ...scoped("ready"), dues: "gt30" });
      expect(dues.rows.length).toBeGreaterThan(0);
      expect(dues.rows.every((r) => r.client === "Urban Kurta Co." || r.client === "PetPal")).toBe(true);
      const recent = await listCaseRows({ ...scoped("open"), from: new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10) });
      expect(recent.rows.every((r) => r.ageDays <= 7)).toBe(true);
    }));

  it("shows settlement, approval and management numbers", () =>
    sb(async () => {
      const s = await settlementKpis();
      expect(s.old.cns).toBe(1); // ECX/CN/03871, unsettled for 48 days
      expect(s.done.full + s.done.part).toBeGreaterThan(0);
      const open = await listSettlementRows({ state: "UNSETTLED" });
      expect(open.find((r) => r.cnNumber === "ECX/CN/03871")?.chased).toBe(3);
      expect(open.find((r) => r.cnNumber === "BD/CN/1190")?.state).toBe("PARTIAL");
      const done = await listSettlementRows({ state: "SETTLED" });
      expect(done.map((r) => r.cnNumber)).toContain("DLV/CN/04355");

      const c = await approvalCounts();
      expect(c.approvals).toBeGreaterThanOrEqual(4);
      expect(c.escalations).toBeGreaterThanOrEqual(3);
      expect(c.decided).toBeGreaterThanOrEqual(3);
      expect((await listApprovalItems({ tab: "approvals" })).length).toBe(c.approvals);
      expect((await listApprovalItems({ tab: "escalations" })).length).toBe(c.escalations);
      expect((await listApprovalItems({ tab: "decided" })).length).toBe(c.decided);

      const d = await managementDashboard({});
      expect(d.pipeline.marked).toBeGreaterThan(30);
      expect(d.scorecard.length).toBeGreaterThanOrEqual(5);
      expect(d.recovery.pct).not.toBeNull();
      expect(d.months).toHaveLength(4);
      expect(d.byAge).toHaveLength(4);
      await managementDashboard({ courier: "Delhivery", client: "Urban Kurta Co.", from: "2026-01-01", to: "2030-01-01" });
    }));

  it("loads the case detail used by both layouts", () =>
    sb(async () => {
      const d = await getCaseDetail(await id("7834501926"));
      expect(d?.case.committedBeforeCn).toBe(true);
      expect(d?.clientCn?.cnNumber).toBe("SD/CN/26-27/00391");
      expect(d?.timeline.map((e) => e.action)).toEqual(expect.arrayContaining(["MARKED", "CLAIM_SENT", "APPROVAL_REQUESTED", "APPROVAL_APPROVED", "BRAND_CN_RELEASED", "FOLLOW_UP"]));
      expect(d?.client?.dues).toBe(124000);
      const consolidated = await getCaseDetail(await id("7834507788"));
      expect(consolidated?.courierCns[0].lines).toHaveLength(2);
      expect(consolidated?.courierCns[0].lines.find((l) => l.awb === "7834507788")?.shortReason).toBe("Courier liability cap applied");
      const a = (await listApprovalItems({ tab: "approvals" }))[0];
      expect((await approvalDetail(a.id))?.case).toBeTruthy();
    }));
});

describe("Update status (OPS)", () => {
  it("records a claim, follow-up and found/close", () =>
    sb(async () => {
      const a = await id("4410556701");
      await applyDisposition(ops, { caseIds: [a], disposition: "CLAIM_SENT", remarks: "Sent", attachments: [doc] });
      let [c] = await q<{ status: string; claimRaisedAt: Date }>("SELECT status, claim_raised_at FROM cases WHERE id=$1", [a]);
      expect(c.status).toBe("CLAIM_RAISED");
      expect(c.claimRaisedAt).toBeTruthy();
      await applyDisposition(ops, { caseIds: [a], disposition: "FOLLOW_UP" });
      [c] = await q("SELECT status, claim_raised_at FROM cases WHERE id=$1", [a]);
      expect(c.status).toBe("FOLLOW_UP");
      await applyDisposition(ops, { caseIds: [a], disposition: "FOUND" });
      expect(await awbs({ ...scoped("closed"), search: "4410556701" })).toContain("4410556701");
    }));

  it("validates a consolidated CN: unique number, partial reason, claim cap, one courier", () =>
    sb(async () => {
      const a = await id("1426653879"); // Blue Dart, claimed 5,000
      const b = await id("9920114563"); // Blue Dart, claimed 2,999
      const base = { caseIds: [a, b], disposition: "CN_RECEIVED" as const, attachments: [doc] };
      const cn = (lines: { caseId: string; amount: number; shortReason?: string }[], no = "BD/CN/TEST-1", total?: number) => ({
        ...base, cn: { cnNumber: no, cnDate: "2026-10-01", totalAmount: total ?? lines.reduce((s, l) => s + l.amount, 0), lines },
      });
      await expect(applyDisposition(ops, cn([{ caseId: a, amount: 3000 }, { caseId: b, amount: 2999 }]))).rejects.toThrow(/short-payment/i);
      await expect(applyDisposition(ops, cn([{ caseId: a, amount: 5500 }, { caseId: b, amount: 2999 }]))).rejects.toThrow(/more than claim/i);
      await expect(applyDisposition(ops, cn([{ caseId: a, amount: 5000 }, { caseId: b, amount: 2999 }], "BD/CN/1190"))).rejects.toThrow(/already recorded/i);
      await expect(applyDisposition(ops, cn([{ caseId: a, amount: 5000 }, { caseId: b, amount: 2999 }], "BD/CN/TEST-1", 9999))).rejects.toThrow(/add up/i);
      await expect(applyDisposition(ops, { ...cn([{ caseId: a, amount: 5000 }, { caseId: b, amount: 2999 }]), attachments: [] })).rejects.toThrow(/Attach/i);
      const mixed = await id("4410556703"); // Delhivery
      await expect(applyDisposition(ops, { caseIds: [a, mixed], disposition: "FOLLOW_UP" })).rejects.toThrow(/one courier/i);
      await applyDisposition(ops, cn([{ caseId: a, amount: 3000, shortReason: "Courier liability cap applied" }, { caseId: b, amount: 2999 }]));
      const [row] = await q<{ courierCnAmount: number; status: string }>("SELECT courier_cn_amount, status FROM cases WHERE id=$1", [a]);
      expect(row.courierCnAmount).toBe(3000);
      expect(row.status).toBe("COURIER_CN_RECEIVED");
      expect(await awbs({ ...scoped("ready"), search: "1426653879" })).toContain("1426653879");
    }));

  it("enforces ownership between OPS and Accounts", () =>
    sb(async () => {
      const api = await id("5590016644");
      await expect(applyDisposition(ops, { caseIds: [api], disposition: "FOLLOW_UP" })).rejects.toThrow(/API-marked/);
      const manual = await id("4410556702").catch(() => null);
      const m = manual ?? (await id("5590018822"));
      await expect(applyDisposition(acc, { caseIds: [m], disposition: "CN_REJECTED", rejectionReason: "x" })).rejects.toThrow(/OPS-marked/);
      await applyDisposition(acc, { caseIds: [m], disposition: "FOLLOW_UP", remarks: "Accounts follow-up on an OPS case" }); // allowed
      await applyDisposition(acc, { caseIds: [api], disposition: "FOLLOW_UP", remarks: "Accounts owns API cases" });
    }));

  it("OPS can mark a case and record the courier CN on a brand-paid case", () =>
    sb(async () => {
      const doc2 = await markCase(ops, "MANUAL", { awb: "9000000001", client: "Wakefit", courier: "DTDC", type: "LOST", itemValue: 1000, clientLiability: 1000, courierLiability: 1000, evidence: [doc] });
      expect(doc2.caseNo).toMatch(/^LD-\d{4}-\d{6}$/);
      await expect(markCase(ops, "MANUAL", { awb: "9000000001", client: "Wakefit", courier: "DTDC", type: "LOST", itemValue: 1, clientLiability: 1, evidence: [doc] })).rejects.toThrow(/already has a case/);
      await expect(markCase(ops, "MANUAL", { awb: "9000000002", client: "Wakefit", courier: "DTDC", type: "LOST", itemValue: 1, clientLiability: 1 })).rejects.toThrow(/Evidence/);
      // exposure case: the courier CN arrives after the brand was paid
      const e = await id("7834501926");
      await applyDisposition(ops, { caseIds: [e], disposition: "CN_RECEIVED", attachments: [doc], cn: { cnNumber: "DLV/CN/LATE-1", cnDate: "2026-10-10", totalAmount: 4000, lines: [{ caseId: e, amount: 4000, shortReason: "Courier liability cap applied" }] } });
      const [r] = await q<{ sdGap: number; status: string }>("SELECT sd_gap, status FROM cases WHERE id=$1", [e]);
      expect(r.sdGap).toBe(850);
      expect(r.status).toBe("CLIENT_CN_RELEASED");
      expect(await awbs({ ...scoped("closed"), search: "7834501926" })).toContain("7834501926"); // now closed for OPS
    }));
});

describe("Release, exceptions and approvals (Accounts / Management)", () => {
  it("releases one brand CN over several cases and sends the above-liability one for approval", () =>
    sb(async () => {
      const [a, b, c] = [await id("7834507788"), await id("7834509100"), await id("9920114571")];
      const items = [{ caseId: a, amount: 5000 }, { caseId: b, amount: 4850 }, { caseId: c, amount: 3500, justification: "Shipping refund agreed with client" }];
      const brandCn = { cnNumber: "SD/CN/TEST-1", cnDate: "2026-10-07", amount: 9850 };
      await expect(releaseBrandCn(ops, { items, brandCn, checked: true, attachments: [doc] })).rejects.toThrow(/Only Accounts/);
      await expect(releaseBrandCn(acc, { items, brandCn, checked: false, attachments: [doc] })).rejects.toThrow(/checked/);
      await expect(releaseBrandCn(acc, { items, brandCn: { ...brandCn, amount: 9000 }, checked: true, attachments: [doc] })).rejects.toThrow(/must equal/);
      await expect(releaseBrandCn(acc, { items: [items[0], items[1], { caseId: c, amount: 3500 }], brandCn, checked: true, attachments: [doc] })).rejects.toThrow(/above brand liability/);
      await expect(releaseBrandCn(acc, { items, brandCn: { ...brandCn, cnNumber: "SD/CN/26-27/00391" }, checked: true, attachments: [doc] })).rejects.toThrow(/already used/);
      const res = await releaseBrandCn(acc, { items, brandCn, checked: true, attachments: [doc], remarks: "ok" });
      expect(res).toMatchObject({ released: 2, releasedAmount: 9850, sentForApproval: 1 });
      const [r] = await q<{ n: number }>("SELECT count(*)::int AS n FROM client_cns WHERE cn_number = 'SD/CN/TEST-1'");
      expect(r.n).toBe(2); // one brand CN, one row per case
      const dup = await releaseBrandCn(acc, { items: [{ caseId: a, amount: 5000 }], brandCn: { cnNumber: "SD/CN/TEST-2", cnDate: "2026-10-07", amount: 5000 }, checked: true, attachments: [doc] }).catch((e) => e);
      expect(String(dup)).toMatch(/already released|closed/i);
      // the one above liability is now with management
      expect(await awbs({ ...scoped("approval"), search: "9920114571" })).toContain("9920114571");
    }));

  it("locks release without a courier CN until an exception is approved; reject closes the case", () =>
    sb(async () => {
      const x = await id("4410556703"); // OPS case, no CN
      await expect(releaseBrandCn(acc, { items: [{ caseId: x, amount: 3200 }], brandCn: { cnNumber: "SD/CN/T9", cnDate: "2026-10-07", amount: 3200 }, checked: true, attachments: [doc] })).rejects.toThrow(/locked/i);
      const body = { caseId: x, exceptionType: "Courier not responding", justification: "No reply", proposedAmount: 3200, documents: [doc] };
      await expect(requestException(ops, body)).rejects.toThrow(/Only Accounts/);
      await expect(requestException(acc, { ...body, documents: [] })).rejects.toThrow(/supporting documents/i);
      const ap = await requestException(acc, body);
      await expect(requestException(acc, body)).rejects.toThrow(/already waiting/i);
      await expect(decideApproval(acc, ap._id, { decision: "APPROVE" })).rejects.toThrow(/Only management/);
      await expect(decideApproval(mgmt, ap._id, { decision: "REJECT" })).rejects.toThrow(/reason/i);
      await decideApproval(mgmt, ap._id, { decision: "REJECT", note: "Keep chasing" });
      const [c] = await q<{ isOpen: boolean; closeReason: string }>("SELECT is_open, close_reason FROM cases WHERE id=$1", [x]);
      expect(c.isOpen).toBe(false);
      expect(c.closeReason).toBe("SD_DECISION_NO_PAYOUT");
      await expect(decideApproval(mgmt, ap._id, { decision: "APPROVE" })).rejects.toThrow(/Already/);
    }));

  it("approval unlocks the release; management sends a request back", () =>
    sb(async () => {
      const x = await id("4410556704"); // no CN, 18 days old
      const ap = await requestException(acc, { caseId: x, exceptionType: "Courier not responding", justification: "No reply", proposedAmount: 2600, documents: [doc] });
      await decideApproval(mgmt, ap._id, { decision: "APPROVE", note: "OK" });
      const [c] = await q<{ releaseApproved: boolean; status: string }>("SELECT release_approved, status FROM cases WHERE id=$1", [x]);
      expect(c.releaseApproved).toBe(true);
      expect(await awbs({ ...scoped("ready"), search: "4410556704" })).toContain("4410556704");
      await releaseBrandCn(acc, { items: [{ caseId: x, amount: 2600 }], brandCn: { cnNumber: "SD/CN/T10", cnDate: "2026-10-07", amount: 2600 }, checked: true, attachments: [doc] });
      const [r] = await q<{ committedBeforeCn: boolean; sdGap: number }>("SELECT committed_before_cn, sd_gap FROM cases WHERE id=$1", [x]);
      expect(r).toMatchObject({ committedBeforeCn: true, sdGap: 2600 });

      const y = await id("1426653902").catch(() => "");
      expect(y).toBeTruthy();
      const z = await id("8812008841"); // API, courier rejected
      const ap2 = await requestException(acc, { caseId: z, exceptionType: "Courier rejected – no CN", justification: "Rejected", proposedAmount: 2300, documents: [doc] });
      await decideApproval(mgmt, ap2._id, { decision: "SEND_BACK", note: "Need the rejection mail" });
      const [s] = await q<{ status: string }>("SELECT status FROM approvals WHERE id=$1", [ap2._id]);
      expect(s.status).toBe("SENT_BACK");
      await requestException(acc, { caseId: z, exceptionType: "Courier rejected – no CN", justification: "Mail attached", proposedAmount: 2300, documents: [doc] }); // can be raised again
    }));

  it("returns an OPS case to OPS and OPS resubmits it", () =>
    sb(async () => {
      const x = await id("9920114571").catch(() => "");
      const ready = await awbs({ ...scoped("ready") });
      const target = ready.find((a) => a !== "9920114571") ?? "";
      expect(target).toBeTruthy();
      const t = await id(target);
      const [row] = await q<{ source: string }>("SELECT source FROM cases WHERE id=$1", [t]);
      const pick = row.source === "MANUAL" ? t : await id("9920114563");
      void x;
      await expect(returnToOps(ops, pick, "bad")).rejects.toThrow(/Only Accounts/);
      await expect(returnToOps(acc, pick, " ")).rejects.toThrow(/fix/i);
      const [src] = await q<{ source: string; clientCnNumber: string | null; courierCnAmount: number }>("SELECT source, client_cn_number, courier_cn_amount FROM cases WHERE id=$1", [pick]);
      if (src.source === "MANUAL" && !src.clientCnNumber && src.courierCnAmount > 0) {
        await returnToOps(acc, pick, "CN amount on the PDF differs");
        expect(await awbs({ ...scoped("ready") })).not.toContain((await q<{ awb: string }>("SELECT awb FROM cases WHERE id=$1", [pick]))[0].awb);
        await resubmitToAccounts(ops, pick, "Fixed");
      }
    }));

  it("records a multi-CN settlement, rejects over-settlement, and closes reconciled cases", () =>
    sb(async () => {
      const open = await listSettlementRows({ state: "UNSETTLED" });
      const ecx = open.filter((r) => r.courier === "Ecom Express");
      expect(ecx.length).toBeGreaterThanOrEqual(2);
      const items = ecx.map((r) => ({ courierCnId: r.id, amount: r.balance }));
      const amount = items.reduce((s, i) => s + i.amount, 0);
      const base = { mode: "FREIGHT_ADJUSTMENT" as const, freightMonth: "2026-10", freightBillNo: "ECX/FB/1", settledOn: "2026-10-08", proof: [doc] };
      await expect(recordSettlement(acc, { ...base, amount: amount + 1, items: [{ ...items[0], amount: items[0].amount + 1 }, ...items.slice(1)] })).rejects.toThrow(/left to settle/i);
      await expect(recordSettlement(acc, { ...base, amount: amount - 1, items })).rejects.toThrow(/must match/i);
      await expect(recordSettlement(acc, { ...base, amount, items, proof: [] })).rejects.toThrow(/proof/i);
      const bank = await listSettlementRows({ state: "UNSETTLED", courier: "Blue Dart" });
      await expect(recordSettlement(acc, { ...base, amount: amount + bank[0].balance, items: [...items, { courierCnId: bank[0].id, amount: bank[0].balance }] })).rejects.toThrow(/one courier/i);
      await recordSettlement(acc, { ...base, amount, items });
      const after = await listSettlementRows({ state: "SETTLED", courier: "Ecom Express" });
      expect(after.length).toBeGreaterThanOrEqual(2);
      const [r] = await q<{ n: number }>("SELECT count(*)::int AS n FROM cases WHERE awb IN ('8812030001','8812030002') AND NOT is_open AND close_reason = 'RECONCILED'");
      expect(r.n).toBe(2);
    }));
});

describe("escalation", () => {
  it("auto-escalates old cases with no courier CN and lists them for management", () =>
    sb(async () => {
      const before = (await approvalCounts()).escalations;
      const res = await runAutoEscalation();
      expect(res.escalated).toBeGreaterThanOrEqual(1);
      const items = await listApprovalItems({ tab: "escalations" });
      expect(items.length).toBe(before + res.escalated);
      expect(items.some((i) => i.reasons.includes("NO_RESPONSE"))).toBe(true);
      expect((await runAutoEscalation()).escalated).toBe(0); // idempotent
    }));

  it("escalation approval makes the case releasable by Accounts", () =>
    sb(async () => {
      const [e] = (await listApprovalItems({ tab: "escalations" })).filter((i) => i.reasons.includes("STOP_CLAIM"));
      await decideApproval(mgmt, e.id, { decision: "APPROVE", note: "Stop claim" });
      const [c] = await q<{ releaseApproved: boolean }>("SELECT release_approved FROM cases WHERE id=$1", [e.caseId]);
      expect(c.releaseApproved).toBe(true);
    }));
});

describe("sandbox isolation", () => {
  it("keeps one sandbox's changes out of another", async () => {
    await startSandbox("ffffffffffff");
    const mine = await sb(() => q<{ n: number }>("SELECT count(*)::int AS n FROM cases WHERE awb = '9000000001'"));
    const other = await withSandbox("ffffffffffff", () => q<{ n: number }>("SELECT count(*)::int AS n FROM cases WHERE awb = '9000000001'"));
    expect(mine[0].n).toBe(1);
    expect(other[0].n).toBe(0);
  });
});
