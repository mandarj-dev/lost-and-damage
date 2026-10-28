// Demo data: dummy orders covering every screen and state, created through the real services
// (so rules, stamps and the timeline apply), with backdated history. Used by the demo sandbox and the seed script.
// The scenarios are described to testers on the /demo page: keep the two in sync.

import { atTime } from "./clock";
import { fmtDayShort } from "./dates";
import { createSandbox, dropSandbox, q, withSandbox } from "./db";
import { applyDisposition, decideApproval, markCase, recordSettlement, releaseBrandCn, requestException } from "./services";
import type { Actor } from "./types";

type Demo = Actor & { go: string };
export const DEMO_ACTORS: Record<"OPS" | "ACCOUNTS" | "MANAGEMENT", Demo> = {
  OPS: { id: "ops@shipdelight.com", name: "Manish", email: "ops@shipdelight.com", role: "OPS", go: "/ops" },
  ACCOUNTS: { id: "accounts@shipdelight.com", name: "Ankit R.", email: "accounts@shipdelight.com", role: "ACCOUNTS", go: "/accounts" },
  MANAGEMENT: { id: "mgmt@shipdelight.com", name: "Vikram N.", email: "mgmt@shipdelight.com", role: "MANAGEMENT", go: "/management" },
};

const person = (name: string, role: "OPS" | "ACCOUNTS"): Actor => ({ id: `${name.split(" ")[0].toLowerCase()}@shipdelight.com`, name, email: `${name.split(" ")[0].toLowerCase()}@shipdelight.com`, role });
const rahul = person("Rahul S.", "OPS");
const priya = person("Priya M.", "OPS");
const sneha = person("Sneha K.", "OPS");
const kavita = person("Kavita J.", "ACCOUNTS");
const ankit = DEMO_ACTORS.ACCOUNTS;
const vikram = DEMO_ACTORS.MANAGEMENT;
const OPS_TEAM = [rahul, priya, sneha];

/** A moment `d` days ago at hh:mm UTC. */
const at = (d: number, hh = 11, mm = 0) => {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() - d);
  t.setUTCHours(hh, mm, 0, 0);
  // Never stamp something in the future (a step 'today' at 14:10 when it is only 09:00).
  return t > new Date() ? new Date(Date.now() - 3 * 3_600_000) : t;
};
const isoDay = (d: number) => at(d).toISOString().slice(0, 10);
const doc = (name: string) => ({ url: `https://example.com/demo/${name}`, name, size: name.endsWith(".png") ? 214_000 : 186_000, contentType: name.endsWith(".png") ? "image/png" : "application/pdf" });

interface Spec {
  awb: string; order: string; client: string; courier: string; type: "LOST" | "DAMAGED"; item: number; age: number;
  brand?: number; courier$?: number; cap?: [number, number]; pick?: number; product?: string; scan?: string; reason?: string; api?: boolean; by?: Actor;
}

/** Fill the current database (live tables, or the active sandbox) with the dummy orders. */
export async function seedDemo() {
  // Clients and what they owe SD (a warning when releasing a brand CN, never a block).
  await q(
    "INSERT INTO clients (name, dues, dues_age_days) VALUES ($1,$2,$3), ($4,$5,$6), ($7,$8,$9), ($10,$11,$12) ON CONFLICT (name) DO NOTHING",
    ["Urban Kurta Co.", 124000, 41, "PetPal", 38500, 36, "boAt", 15000, 12, "Nuvo Home", 0, 0],
  );

  let n = 0;
  const mark = (s: Spec) => {
    const by = s.api ? null : (s.by ?? OPS_TEAM[n++ % OPS_TEAM.length]);
    return atTime(at(s.age, 18, 30), () =>
      markCase(by, s.api ? "API" : "MANUAL", {
        awb: s.awb, orderId: s.order, client: s.client, courier: s.courier, type: s.type,
        itemValue: s.item, clientLiability: s.brand ?? s.item, courierLiability: s.courier$ ?? s.item,
        clientLiabilityCap: s.cap?.[0], courierLiabilityCap: s.cap?.[1],
        pickedUpAt: at(s.age + (s.pick ?? 6), 9, 0), markedAt: at(s.age, 18, 30),
        product: s.product ?? (s.type === "LOST" ? "Apparel set" : "Home decor item"),
        lastScan: s.scan ?? `${s.courier} hub · In transit · ${fmtDayShort(at(s.age + 3))}`,
        markingReason: s.api ? undefined : (s.reason ?? (s.type === "LOST" ? "No scan for 4 days; hub confirmed shipment untraceable." : "Customer refused delivery: outer pack torn, product damaged.")),
        courierRemark: s.api ? (s.type === "LOST" ? `${s.courier} status: shipment lost in transit.` : `${s.courier} status: damaged in transit.`) : undefined,
        evidence: s.api ? [] : [doc(`evidence-${s.awb}.pdf`)],
      }),
    ).then((c) => c._id);
  };

  // ---- Mark every case (in parallel; the history comes next) ----
  const spec: Record<string, Spec> = {
    m1: { awb: "7834501926", order: "SO-118274", client: "Urban Kurta Co.", courier: "Delhivery", type: "LOST", item: 4850, age: 25, cap: [10000, 5000], product: "Cotton kurta set × 2", scan: "Bhiwandi hub · In transit · 08 Sep", by: rahul },
    m2: { awb: "9920114563", order: "SO-120044", client: "Urban Kurta Co.", courier: "Blue Dart", type: "LOST", item: 2999, age: 3, pick: 25, by: rahul },
    m3: { awb: "1426653879", order: "ORD-55912", client: "Nuvo Home", courier: "Blue Dart", type: "LOST", item: 12400, brand: 10000, courier$: 5000, age: 19, by: priya },
    m4: { awb: "8812004417", order: "PP-7731", client: "PetPal", courier: "Ecom Express", type: "LOST", item: 8990, courier$: 5000, age: 35, by: sneha },
    m5: { awb: "3302918476", order: "SO-118901", client: "Urban Kurta Co.", courier: "Shadowfax", type: "LOST", item: 3450, age: 53, by: rahul },
    m6: { awb: "5590018822", order: "PP-7802", client: "PetPal", courier: "Xpressbees", type: "DAMAGED", item: 5600, courier$: 5000, age: 15, pick: 20, by: priya },
    m7: { awb: "7834507788", order: "SO-119230", client: "Urban Kurta Co.", courier: "Delhivery", type: "DAMAGED", item: 4500, brand: 5000, courier$: 4500, age: 29, product: "Embroidered kurta set", reason: "Customer refused: torn outer pack, product stained.", by: rahul },
    m8: { awb: "7834509100", order: "SO-118300", client: "Urban Kurta Co.", courier: "Delhivery", type: "LOST", item: 4850, age: 24, by: rahul },
    m9: { awb: "9920114571", order: "SO-120071", client: "Urban Kurta Co.", courier: "Blue Dart", type: "LOST", item: 2999, age: 4, by: sneha },
    m10: { awb: "3302914410", order: "NH-40388", client: "Nuvo Home", courier: "Shadowfax", type: "DAMAGED", item: 15900, brand: 10000, courier$: 5000, age: 7, by: sneha },
    m11: { awb: "5590017720", order: "GL-21400", client: "GlowLab Skin", courier: "Xpressbees", type: "DAMAGED", item: 1980, age: 14, by: priya },
    m12: { awb: "3302917703", order: "NH-39880", client: "Nuvo Home", courier: "Shadowfax", type: "LOST", item: 8710, age: 49, by: rahul },
    m13: { awb: "4410556701", order: "WK-10021", client: "Wakefit", courier: "DTDC", type: "LOST", item: 2150, age: 2, by: priya },
    m15: { awb: "4410556703", order: "MM-77120", client: "Mamaearth", courier: "Delhivery", type: "LOST", item: 3200, age: 21, by: rahul },
    m16: { awb: "4410556704", order: "BT-33041", client: "boAt", courier: "Blue Dart", type: "LOST", item: 2600, age: 18, by: priya },
    m17: { awb: "1426653900", order: "ORD-55920", client: "Nuvo Home", courier: "Blue Dart", type: "LOST", item: 12400, brand: 10000, courier$: 10000, age: 20, by: priya },
    m18: { awb: "1426653901", order: "ORD-55921", client: "Nuvo Home", courier: "Blue Dart", type: "LOST", item: 1500, age: 19, by: sneha },
    m19: { awb: "1426653902", order: "ORD-55922", client: "Nuvo Home", courier: "Blue Dart", type: "DAMAGED", item: 2200, age: 18, by: sneha },
    m20: { awb: "4410556710", order: "MM-77130", client: "Mamaearth", courier: "Delhivery", type: "LOST", item: 1800, age: 30, by: sneha },
    h1: { awb: "5590030001", order: "MF-3001", client: "Mamaearth", courier: "DTDC", type: "LOST", item: 2500, age: 45, by: priya },
    h2: { awb: "5590030002", order: "MF-3002", client: "Mamaearth", courier: "DTDC", type: "DAMAGED", item: 1900, age: 40, by: sneha },
    h3: { awb: "5590030003", order: "BT-7001", client: "boAt", courier: "Delhivery", type: "LOST", item: 2800, age: 30, by: priya },
    a1: { awb: "5590012345", order: "GL-20931", client: "GlowLab Skin", courier: "Xpressbees", type: "LOST", item: 1299, age: 20, api: true },
    a2: { awb: "5590016645", order: "GL-21151", client: "GlowLab Skin", courier: "Xpressbees", type: "LOST", item: 1750, age: 12, api: true },
    a3: { awb: "5590016646", order: "GL-21152", client: "GlowLab Skin", courier: "Xpressbees", type: "DAMAGED", item: 1841, age: 11, api: true },
    a4: { awb: "8812009100", order: "GL-21111", client: "GlowLab Skin", courier: "Ecom Express", type: "DAMAGED", item: 1850, age: 11, api: true },
    a5: { awb: "8812009101", order: "GL-21112", client: "PetPal", courier: "Ecom Express", type: "LOST", item: 2500, age: 10, api: true },
    a6: { awb: "8812010277", order: "PP-7820", client: "PetPal", courier: "Ecom Express", type: "DAMAGED", item: 3200, courier$: 3000, age: 14, api: true, product: "Ceramic pet feeder set" },
    a7: { awb: "5590016644", order: "GL-21150", client: "GlowLab Skin", courier: "Xpressbees", type: "LOST", item: 1750, age: 10, api: true },
    a8: { awb: "7834511290", order: "NH-40455", client: "Nuvo Home", courier: "Delhivery", type: "LOST", item: 11800, brand: 10000, courier$: 10000, age: 21, api: true },
    a9: { awb: "6619205530", order: "SO-120118", client: "Urban Kurta Co.", courier: "DTDC", type: "LOST", item: 2650, courier$: 2000, age: 5, pick: 16, api: true },
    a10: { awb: "8812008841", order: "GL-21060", client: "GlowLab Skin", courier: "Ecom Express", type: "DAMAGED", item: 2300, age: 19, api: true },
    a11: { awb: "6619203384", order: "GL-21007", client: "GlowLab Skin", courier: "DTDC", type: "LOST", item: 2150, courier$: 2000, age: 25, api: true },
    a12: { awb: "5590019034", order: "GL-21188", client: "GlowLab Skin", courier: "Delhivery", type: "DAMAGED", item: 2400, age: 6, pick: 21, api: true },
    a13: { awb: "1426660412", order: "NH-39555", client: "Nuvo Home", courier: "Blue Dart", type: "DAMAGED", item: 11000, brand: 10000, courier$: 10000, age: 30, api: true },
    a14: { awb: "9920114555", order: "SO-120055", client: "Urban Kurta Co.", courier: "Blue Dart", type: "LOST", item: 3500, brand: 3000, courier$: 3000, age: 10, api: true },
    a15: { awb: "8812030001", order: "PP-9001", client: "PetPal", courier: "Ecom Express", type: "LOST", item: 3100, age: 55, api: true },
    a16: { awb: "8812030002", order: "PP-9002", client: "PetPal", courier: "Ecom Express", type: "DAMAGED", item: 2300, age: 54, api: true },
    a17: { awb: "8812040001", order: "GL-8001", client: "GlowLab Skin", courier: "Delhivery", type: "LOST", item: 3000, age: 40, api: true },
    a18: { awb: "8812040002", order: "GL-8002", client: "GlowLab Skin", courier: "Delhivery", type: "DAMAGED", item: 3200, age: 39, api: true },
    a19: { awb: "7000100001", order: "LK-5001", client: "Lenskart", courier: "Shadowfax", type: "LOST", item: 3800, age: 36, api: true },
    a20: { awb: "7000100002", order: "LK-5002", client: "Lenskart", courier: "Shadowfax", type: "DAMAGED", item: 3000, age: 35, api: true },
  };
  const entries = Object.entries(spec);
  const ids: Record<string, string> = {};
  // Five at a time: the connection pool is small.
  for (let i = 0; i < entries.length; i += 5)
    await Promise.all(entries.slice(i, i + 5).map(async ([k, s]) => { ids[k] = await mark(s); }));

  // ---- helpers for the history ----
  const claim = (who: Actor, k: string, d: number, files: string[] = [], remarks?: string) =>
    atTime(at(d, 10, 15), () => applyDisposition(who, { caseIds: [ids[k]], disposition: "CLAIM_SENT", remarks, attachments: files.map(doc) }));
  const follow = (who: Actor, k: string, d: number, remarks?: string, files: string[] = []) =>
    atTime(at(d, 16, 5), () => applyDisposition(who, { caseIds: [ids[k]], disposition: "FOLLOW_UP", remarks, attachments: files.map(doc) }));
  const cn = (who: Actor, lines: { k: string; amount: number; reason?: string }[], number: string, d: number, file: string) =>
    atTime(at(d, 14, 10), () =>
      applyDisposition(who, {
        caseIds: lines.map((l) => ids[l.k]), disposition: "CN_RECEIVED", attachments: [doc(file)],
        cn: { cnNumber: number, cnDate: isoDay(d), totalAmount: lines.reduce((s, l) => s + l.amount, 0), lines: lines.map((l) => ({ caseId: ids[l.k], amount: l.amount, shortReason: l.reason })) },
      }),
    );
  const reject = (who: Actor, k: string, d: number, why: string, file: string) =>
    atTime(at(d, 12, 0), () => applyDisposition(who, { caseIds: [ids[k]], disposition: "CN_REJECTED", rejectionReason: why, attachments: [doc(file)] }));
  const escalate = (who: Actor, k: string, d: number, type: string, why: string) =>
    atTime(at(d, 15, 30), () => applyDisposition(who, { caseIds: [ids[k]], disposition: "ESCALATE", escalation: { type, justification: why } }));
  const exception = (k: string, d: number, type: string, why: string, amount: number, files: string[]) =>
    atTime(at(d, 12, 48), () => requestException(ankit, { caseId: ids[k], exceptionType: type, justification: why, proposedAmount: amount, neededBy: at(d - 3), documents: files.map(doc) }));
  const decide = (approvalId: string, d: number, decision: "APPROVE" | "REJECT", note?: string) =>
    atTime(at(d, 17, 0), () => decideApproval(vikram, approvalId, { decision, note }));
  const release = (who: Actor, items: { k: string; amount: number; why?: string }[], number: string, d: number, file: string) =>
    atTime(at(d, 12, 48), () =>
      releaseBrandCn(who, {
        items: items.map((i) => ({ caseId: ids[i.k], amount: i.amount, justification: i.why })),
        brandCn: { cnNumber: number, cnDate: isoDay(d), amount: items.reduce((s, i) => s + i.amount, 0) },
        checked: true, attachments: [doc(file)],
      }),
    );
  const cnId = async (no: string) => (await q<{ _id: string }>("SELECT id FROM courier_cns WHERE cn_number = $1", [no]))[0]._id;
  const pendingFor = async (k: string) => (await q<{ _id: string }>("SELECT id FROM approvals WHERE case_id = $1 AND status = 'PENDING'", [ids[k]]))[0]._id;
  const prevMonth = at(35).toISOString().slice(0, 7);

  // ---- Scenarios (each touches its own cases, so they run side by side) ----
  const scenarios: (() => Promise<unknown>)[] = [
    // 1. Brand paid before the courier CN (approved exception): OPS still chasing, red banner, "Committed before CN".
    async () => {
      await claim(rahul, "m1", 23, ["claim-email_SO-118274.pdf", "invoice_SO-118274.pdf"], "Sent to Delhivery claims desk. Claim ₹4,850.");
      const a = await exception("m1", 18, "Client L&D agreement overrides courier terms", "Brand payout date under the L&D agreement has passed; courier has not responded.", 4850, ["ld-agreement-urbankurta.pdf"]);
      await decide(a._id, 17, "APPROVE", "OK per agreement.");
      await release(ankit, [{ k: "m1", amount: 4850 }], "SD/CN/26-27/00391", 17, "SD_CN_00391.pdf");
      await follow(priya, "m1", 9, "Courier asked for the invoice copy; resent with claim reference.", ["followup-1_delhivery.pdf"]);
      await follow(priya, "m1", 1, "Courier asked for invoice copy again; resent with claim reference.", ["followup-2_delhivery.pdf"]);
    },
    // 2. Claim raised / follow-ups / rejected / exception waiting on management.
    async () => { await claim(priya, "m3", 18, ["claim-email_ORD-55912.pdf"]); },
    async () => {
      await claim(sneha, "m4", 33, ["claim-email_PP-7731.pdf"]);
      await reject(sneha, "m4", 12, "Claim filed after the courier window; no open-delivery POD.", "rejection-mail.pdf");
      await exception("m4", 1, "Courier rejected – no CN", "Courier rejected the claim as filed after the window. Client L&D terms cover the loss, so SD should pay the brand.", 8990, ["rejection-mail.pdf"]);
    },
    async () => {
      await claim(rahul, "m5", 50, ["claim-email_SO-118901.pdf"]);
      await follow(rahul, "m5", 38, "First reminder to Shadowfax KAM.");
      await follow(rahul, "m5", 20, "Second reminder; no reply.");
      await escalate(rahul, "m5", 4, "Stop claim – SD absorbs", "No response for 45 days after repeated reminders. Recommend SD absorbs and closes the claim.");
    },
    // 3. Consolidated courier CN with a partial line, ready to release (Urban Kurta has dues > 30 d).
    async () => {
      await claim(rahul, "m7", 27, ["claim-email_SO-119230.pdf", "invoice_SO-119230.pdf"], "Claim ₹4,500 with photos and invoice.");
      await follow(priya, "m7", 18, "Asked Delhivery for CN status.");
      await follow(ankit, "m7", 8, "Asked Delhivery for CN status.");
      await claim(rahul, "m8", 22, ["claim-email_SO-118300.pdf"]);
      await cn(priya, [{ k: "m7", amount: 3000, reason: "Courier liability cap applied" }, { k: "m8", amount: 4850 }], "DLV/CN/04418", 1, "DLV_CN_04418.pdf");
    },
    async () => {
      await claim(sneha, "m9", 3);
      await cn(sneha, [{ k: "m9", amount: 2999 }], "BD/CN/1203", 0, "BD_CN_1203.pdf");
    },
    async () => { await escalate(sneha, "m10", 1, "High-value case", "High value: above the cap. Needs a call on the claim route."); },
    async () => {
      await claim(priya, "m11", 13);
      await follow(priya, "m11", 6, "Reminder sent.");
      await escalate(priya, "m11", 1, "Stop claim – SD absorbs", "Courier silent for two weeks on a small claim; chasing costs more than the claim.");
    },
    // 4. Six follow-ups, then an exception request (the top item in Management's queue).
    async () => {
      await claim(rahul, "m12", 47, ["claim-email_NH-39880.pdf"]);
      for (const d of [40, 34, 28, 20, 12, 6]) await follow(rahul, "m12", d, "Reminder to Shadowfax KAM; no reply.");
      await exception("m12", 2, "Courier not responding", "Escalated to Shadowfax key account manager twice with no reply. Client payout date under the L&D agreement has passed.", 8710, ["followup-log.pdf", "NuvoHome-LD-agreement.pdf"]);
    },
    // 5. Plain open cases for the escalation and status tests.
    async () => { await claim(sneha, "m15", 20); await follow(rahul, "m15", 10, "First reminder sent."); },
    async () => { await claim(priya, "m16", 17); },
    async () => { await applyDisposition(sneha, { caseIds: [ids.m20], disposition: "FOUND", remarks: "Courier located the parcel; delivered to customer." }).then(() => undefined); },
    // 6. Blue Dart CN BD/CN/1190 over three OPS cases: two released, one waiting; part-settled by bank transfer.
    async () => {
      await claim(priya, "m17", 19); await claim(sneha, "m18", 18); await claim(sneha, "m19", 17);
      await cn(sneha, [{ k: "m17", amount: 5000, reason: "Courier liability cap applied" }, { k: "m18", amount: 1500 }, { k: "m19", amount: 2200 }], "BD/CN/1190", 9, "BD_CN_1190.pdf");
      await release(ankit, [{ k: "m18", amount: 1500 }, { k: "m19", amount: 2200 }], "SD/CN/26-27/00380", 5, "SD_CN_00380.pdf");
      await atTime(at(4, 13, 0), async () =>
        recordSettlement(ankit, { mode: "BANK_TRANSFER", utr: "ICIC2610040091", amount: 4000, settledOn: at(4), items: [{ courierCnId: await cnId("BD/CN/1190"), amount: 4000 }], proof: [doc("bank-advice-ICIC2610040091.pdf")] }));
    },
    // 7. History: an approved exception (released), a rejected one (closed, no payout), an approved escalation (released).
    async () => {
      await claim(priya, "h1", 44);
      const a = await exception("h1", 20, "Courier not responding", "Courier silent for 40 days; client agreement requires payout.", 2500, ["followup-log.pdf"]);
      await decide(a._id, 18, "APPROVE", "Approved; recover from courier if it ever responds.");
      await release(ankit, [{ k: "h1", amount: 2500 }], "SD/CN/26-27/00350", 18, "SD_CN_00350.pdf");
    },
    async () => {
      await claim(sneha, "h2", 39);
      const a = await exception("h2", 15, "Courier not responding", "No courier CN after 24 days.", 1900, ["followup-log.pdf"]);
      await decide(a._id, 13, "REJECT", "Courier claim is still open; keep chasing before paying.");
    },
    async () => {
      await claim(priya, "h3", 29);
      await escalate(priya, "h3", 12, "Stop claim – SD absorbs", "Courier closed the ticket without a CN; no basis to continue.");
      await decide(await pendingFor("h3"), 10, "APPROVE", "Stop claim; SD absorbs.");
      await release(ankit, [{ k: "h3", amount: 2800 }], "SD/CN/26-27/00355", 9, "SD_CN_00355.pdf");
    },
    // 8. API cases (Accounts owns them).
    async () => {
      await claim(ankit, "a1", 19, ["claim-email_GL-20931.pdf"]); await claim(ankit, "a2", 11); await claim(ankit, "a3", 10);
      await cn(kavita, [{ k: "a1", amount: 1299 }, { k: "a2", amount: 1750 }, { k: "a3", amount: 1841 }], "XB/CN/7781", 5, "XB_CN_7781.pdf");
    },
    async () => {
      await claim(ankit, "a4", 10); await claim(ankit, "a5", 9);
      await cn(kavita, [{ k: "a4", amount: 1850 }, { k: "a5", amount: 2500 }], "ECX/CN/04102", 2, "ECX_CN_04102.pdf");
    },
    async () => {
      await claim(ankit, "a6", 12, ["claim-email_PP-7820.pdf", "unboxing-stills.png"], "Claim ₹3,000 with unboxing stills and invoice.");
      await follow(kavita, "a6", 4, "Ecom acknowledged; CN under review.", ["followup_ecom_03Oct.pdf"]);
    },
    async () => { await claim(ankit, "a7", 9); },
    async () => { await claim(ankit, "a8", 20); await follow(kavita, "a8", 6, "Delhivery says CN in approval.", ["followup_delhivery_06Oct.pdf"]); },
    async () => { await claim(ankit, "a10", 18); await reject(kavita, "a10", 3, "Rejected: no open-delivery POD.", "rejection-mail_GL-21060.pdf"); },
    async () => { await claim(ankit, "a11", 24); },
    // 9. Above brand liability: one already waiting on management, one for the tester to try.
    async () => {
      await claim(ankit, "a13", 29);
      await cn(kavita, [{ k: "a13", amount: 10000 }], "BD/CN/1210", 8, "BD_CN_1210.pdf");
      await atTime(at(3, 11, 20), () => releaseBrandCn(kavita, { items: [{ caseId: ids.a13, amount: 11000, justification: "Shipping charge refund agreed with client; see attached mail." }], attachments: [doc("client-mail_shipping-refund.pdf")] }));
    },
    async () => { await claim(ankit, "a14", 9); await cn(kavita, [{ k: "a14", amount: 3000 }], "BD/CN/1195", 3, "BD_CN_1195.pdf"); },
    // 10. Released and settling: PetPal (unsettled 48 days, chased), GlowLab (fully settled, closed), Lenskart (part-settled).
    async () => {
      await claim(ankit, "a15", 54); await claim(ankit, "a16", 53);
      await cn(kavita, [{ k: "a15", amount: 3100 }, { k: "a16", amount: 2300 }], "ECX/CN/03871", 48, "ECX_CN_03871.pdf");
      await release(ankit, [{ k: "a15", amount: 3100 }, { k: "a16", amount: 2300 }], "SD/CN/26-27/00302", 40, "SD_CN_00302.pdf");
      await q("UPDATE courier_cns SET chased_count = 3 WHERE cn_number = 'ECX/CN/03871'");
    },
    async () => {
      await claim(ankit, "a17", 39); await claim(ankit, "a18", 38);
      await cn(kavita, [{ k: "a17", amount: 3000 }, { k: "a18", amount: 3200 }], "DLV/CN/04355", 27, "DLV_CN_04355.pdf");
      await release(ankit, [{ k: "a17", amount: 3000 }, { k: "a18", amount: 3200 }], "SD/CN/26-27/00318", 22, "SD_CN_00318.pdf");
      await atTime(at(6, 13, 0), async () =>
        recordSettlement(ankit, { mode: "FREIGHT_ADJUSTMENT", freightMonth: prevMonth, freightBillNo: "DLV/FB/2609-088", amount: 6200, settledOn: at(6), items: [{ courierCnId: await cnId("DLV/CN/04355"), amount: 6200 }], proof: [doc("DLV_FB_2609-088.pdf")] }));
    },
    async () => {
      await claim(ankit, "a19", 35); await claim(ankit, "a20", 34);
      await cn(kavita, [{ k: "a19", amount: 3800 }, { k: "a20", amount: 3000 }], "SFX/CN/0991", 23, "SFX_CN_0991.pdf");
      await release(ankit, [{ k: "a19", amount: 3800 }, { k: "a20", amount: 3000 }], "SD/CN/26-27/00325", 20, "SD_CN_00325.pdf");
      await atTime(at(8, 13, 0), async () =>
        recordSettlement(ankit, { mode: "FREIGHT_ADJUSTMENT", freightMonth: prevMonth, freightBillNo: "SFX/INV/0926-51", amount: 4000, settledOn: at(8), items: [{ courierCnId: await cnId("SFX/CN/0991"), amount: 4000 }], proof: [doc("SFX_FB_0926-51.pdf")] }));
    },
  ];
  // Three scenarios at a time: each is a chain of small transactions.
  for (let i = 0; i < scenarios.length; i += 3) await Promise.all(scenarios.slice(i, i + 3).map((s) => s()));

  // The decided approvals above age the management stats; one more case is released today above brand liability.
  await atTime(at(0, 9, 40), () =>
    releaseBrandCn(ankit, { items: [{ caseId: ids.a14, amount: 3500, justification: "Shipping charge refund agreed with the client; see attached mail." }], attachments: [doc("client-mail_SO-120055.pdf")] }),
  );
}

/** Create a fresh sandbox with the dummy orders. */
export async function startSandbox(sid: string) {
  await createSandbox(sid);
  await withSandbox(sid, seedDemo);
}

/** Throw the sandbox away and rebuild it with the original dummy orders. */
export async function resetSandbox(sid: string) {
  await dropSandbox(sid);
  await startSandbox(sid);
}
