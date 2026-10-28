// Read models for Courier settlements, the Management dashboard and the approvals queue.

import { monthShort, monthShortYear } from "./dates";
import { connectDB, q } from "./db";
import { daysBetween } from "./rules";
import type { ApprovalDoc, CaseDoc, CourierCNDoc, SettlementDoc, WithId } from "@/models";

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : "");
const monthShortOf = (ym?: string | null) => (ym ? monthShort(ym) : "");
const monthLong = (ym?: string | null) => (ym ? monthShortYear(ym) : "");

/** Parameter collector for hand-built SQL. */
function params() {
  const p: unknown[] = [];
  return {
    p,
    add(v: unknown) {
      p.push(v);
      return `$${p.length}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Courier settlements
// ---------------------------------------------------------------------------
export interface SettlementRow {
  id: string;
  cnNumber: string;
  courier: string;
  cnDate: string;
  awbs: number;
  total: number;
  settled: number;
  balance: number;
  state: string;
  enteredBy: string;
  enteredByRole: string;
  unsettledDays: number;
  expected: string;
  chased: number;
  last: { mode: string; on: string; ref: string | null; month: string | null; utr: string | null } | null;
  released: number;
  lines: { caseId: string; awb: string; amount: number }[];
}

export interface SettlementFilter {
  state: "UNSETTLED" | "SETTLED";
  search?: string;
  courier?: string;
  mode?: string;
  from?: string;
  to?: string;
}

export async function settlementKpis() {
  await connectDB();
  const [open] = await q<{ amount: number; cns: number; orders: number; partly: number }>(
    `SELECT COALESCE(SUM(total_amount - settled_amount), 0) AS amount, count(*)::int AS cns,
            COALESCE(SUM(jsonb_array_length(lines)), 0)::int AS orders,
            count(*) FILTER (WHERE settlement_state = 'PARTIAL')::int AS partly
     FROM courier_cns WHERE settlement_state <> 'SETTLED'`,
  );
  const [old] = await q<{ amount: number; cns: number; courier: string | null }>(
    `SELECT COALESCE(SUM(total_amount - settled_amount), 0) AS amount, count(*)::int AS cns,
            (array_agg(courier ORDER BY cn_date))[1] AS courier
     FROM courier_cns WHERE settlement_state <> 'SETTLED' AND cn_date < now() - interval '30 days'`,
  );
  const [done] = await q<{ amount: number; full: number; part: number }>(
    `SELECT COALESCE(SUM(s.amount), 0) AS amount,
            count(DISTINCT s.courier_cn_id) FILTER (WHERE cn.settlement_state = 'SETTLED')::int AS full,
            count(DISTINCT s.courier_cn_id) FILTER (WHERE cn.settlement_state = 'PARTIAL')::int AS part
     FROM settlements s JOIN courier_cns cn ON cn.id = s.courier_cn_id
     WHERE s.settled_on >= now() - interval '30 days'`,
  );
  const modes = await q<{ mode: string; amount: number }>(
    "SELECT mode, COALESCE(SUM(amount), 0) AS amount FROM settlements WHERE settled_on >= now() - interval '30 days' GROUP BY mode",
  );
  const [counts] = await q<{ unsettled: number; settled: number }>(
    `SELECT count(*) FILTER (WHERE settlement_state <> 'SETTLED')::int AS unsettled,
            count(*) FILTER (WHERE settlement_state = 'SETTLED')::int AS settled
     FROM courier_cns`,
  );
  return {
    open, old, done, counts,
    freight: modes.find((m) => m.mode === "FREIGHT_ADJUSTMENT")?.amount ?? 0,
    bank: modes.find((m) => m.mode === "BANK_TRANSFER")?.amount ?? 0,
  };
}

export async function listSettlementRows(f: SettlementFilter): Promise<SettlementRow[]> {
  await connectDB();
  const b = params();
  const cond: string[] = [f.state === "SETTLED" ? "cn.settlement_state = 'SETTLED'" : "cn.settlement_state <> 'SETTLED'"];
  if (f.search?.trim()) {
    const n = b.add(`%${f.search.trim()}%`);
    cond.push(
      `(cn.cn_number ILIKE ${n} OR EXISTS (SELECT 1 FROM settlements s WHERE s.courier_cn_id = cn.id AND (s.utr ILIKE ${n} OR s.freight_invoice_ref ILIKE ${n})))`,
    );
  }
  if (f.courier) cond.push(`cn.courier = ${b.add(f.courier)}`);
  if (f.mode === "BANK_TRANSFER" || f.mode === "FREIGHT_ADJUSTMENT") cond.push(`cn.expected_mode = ${b.add(f.mode)}`);
  if (f.from) cond.push(`cn.cn_date >= ${b.add(new Date(`${f.from}T00:00:00Z`))}`);
  if (f.to) cond.push(`cn.cn_date <= ${b.add(new Date(`${f.to}T23:59:59.999Z`))}`);
  const cns = await q<WithId<CourierCNDoc>>(
    `SELECT cn.* FROM courier_cns cn WHERE ${cond.join(" AND ")} ORDER BY cn.cn_date ${f.state === "SETTLED" ? "DESC" : "ASC"} LIMIT 200`,
    b.p,
  );
  if (!cns.length) return [];
  const [lasts, cases] = await Promise.all([
    q<WithId<SettlementDoc>>(
      "SELECT DISTINCT ON (courier_cn_id) * FROM settlements WHERE courier_cn_id = ANY($1::uuid[]) ORDER BY courier_cn_id, settled_on DESC, created_at DESC",
      [cns.map((c) => c._id)],
    ),
    q<{ _id: string; clientCnNumber: string | null }>("SELECT id, client_cn_number FROM cases WHERE id = ANY($1::uuid[])", [
      [...new Set(cns.flatMap((c) => c.lines.map((l) => l.caseId)))],
    ]),
  ]);
  const lastBy = new Map(lasts.map((s) => [s.courierCnId, s]));
  const releasedIds = new Set(cases.filter((c) => c.clientCnNumber).map((c) => c._id));
  return cns.map((c) => {
    const last = lastBy.get(c._id);
    return {
      id: c._id,
      cnNumber: c.cnNumber,
      courier: c.courier,
      cnDate: iso(c.cnDate),
      awbs: c.lines.length,
      total: c.totalAmount,
      settled: c.settledAmount,
      balance: Math.round((c.totalAmount - c.settledAmount) * 100) / 100,
      state: c.settlementState,
      enteredBy: c.recorded.name,
      enteredByRole: c.recorded.role,
      unsettledDays: daysBetween(c.cnDate),
      expected: c.expectedMode === "BANK_TRANSFER" ? "bank transfer" : c.expectedMonth ? `${monthShortOf(c.expectedMonth)} freight bill` : "freight bill",
      chased: c.chasedCount,
      last: last
        ? { mode: last.mode, on: iso(last.settledOn), ref: last.freightInvoiceRef ?? null, month: last.adjustmentMonth ? monthLong(last.adjustmentMonth) : null, utr: last.utr ?? null }
        : null,
      released: c.lines.filter((l) => releasedIds.has(l.caseId)).length,
      lines: c.lines.map((l) => ({ caseId: l.caseId, awb: l.awb, amount: l.amount })),
    };
  });
}

// ---------------------------------------------------------------------------
// Approvals & escalations
// ---------------------------------------------------------------------------
export interface ApprovalItem {
  id: string;
  ref: string | null;
  kind: string;
  awb: string;
  caseId: string;
  caseType: "LOST" | "DAMAGED";
  client: string;
  courier: string;
  orderId: string | null;
  reasons: string[];
  typeLabel: string;
  amount: number;
  requestedBy: string;
  requestedByRole: string;
  requestedAt: string;
  waitingDays: number;
  status: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

type ApprovalJoin = WithId<ApprovalDoc> & { caseType: "LOST" | "DAMAGED"; orderId: string | null };

const typeLabel = (a: Pick<ApprovalDoc, "reasons" | "exceptionType" | "kind">) =>
  a.reasons.includes("NO_COURIER_CN") ? "Release without courier CN"
  : a.reasons.includes("ABOVE_BRAND_LIABILITY") ? "Above brand liability"
  : a.reasons.includes("NO_RESPONSE") ? "No courier response · 15 d"
  : a.exceptionType ?? "Stop claim – SD absorbs";

const toItem = (a: ApprovalJoin): ApprovalItem => ({
  id: a._id,
  ref: a.ref ?? null,
  kind: a.kind,
  awb: a.awb,
  caseId: a.caseId,
  caseType: a.caseType,
  client: a.client ?? "",
  courier: a.courier ?? "",
  orderId: a.orderId ?? null,
  reasons: a.reasons,
  typeLabel: a.reasons.includes("STOP_CLAIM") ? (a.exceptionType ?? "Stop claim – SD absorbs") : typeLabel(a),
  amount: a.requestedAmount,
  requestedBy: a.requested.name,
  requestedByRole: a.requested.role,
  requestedAt: iso(a.createdAt),
  waitingDays: daysBetween(a.createdAt),
  status: a.status,
  decidedBy: a.decided?.name ?? null,
  decidedAt: a.decided ? iso(a.decided.at) : null,
});

export async function approvalCounts() {
  await connectDB();
  const [r] = await q<{ approvals: number; approvalsAmt: number; escalations: number; decided: number; oldest: number }>(
    `SELECT count(*) FILTER (WHERE status = 'PENDING' AND kind = 'APPROVAL')::int AS approvals,
            COALESCE(SUM(requested_amount) FILTER (WHERE status = 'PENDING' AND kind = 'APPROVAL'), 0) AS approvals_amt,
            count(*) FILTER (WHERE status = 'PENDING' AND kind = 'ESCALATION')::int AS escalations,
            count(*) FILTER (WHERE status <> 'PENDING' AND (decided->>'at')::timestamptz >= now() - interval '30 days')::int AS decided,
            COALESCE(MAX(EXTRACT(EPOCH FROM (now() - created_at)) / 86400) FILTER (WHERE status = 'PENDING'), 0) AS oldest
     FROM approvals`,
  );
  return { ...r, oldest: Math.floor(r.oldest) };
}

export async function listApprovalItems(f: { tab: "approvals" | "escalations" | "decided"; type?: string; sort?: string }) {
  await connectDB();
  const b = params();
  const cond: string[] =
    f.tab === "decided"
      ? ["a.status <> 'PENDING'", "(a.decided->>'at')::timestamptz >= now() - interval '30 days'"]
      : ["a.status = 'PENDING'", `a.kind = ${b.add(f.tab === "approvals" ? "APPROVAL" : "ESCALATION")}`];
  if (f.type === "NO_COURIER_CN" || f.type === "ABOVE_BRAND_LIABILITY" || f.type === "STOP_CLAIM" || f.type === "NO_RESPONSE")
    cond.push(`${b.add(f.type)} = ANY(a.reasons)`);
  const order =
    f.tab === "decided" ? "(a.decided->>'at')::timestamptz DESC"
    : f.sort === "newest" ? "a.created_at DESC"
    : f.sort === "amount" ? "a.requested_amount DESC"
    : "a.created_at ASC";
  const rows = await q<ApprovalJoin>(
    `SELECT a.*, c.type AS case_type, c.order_id AS order_id
     FROM approvals a JOIN cases c ON c.id = a.case_id
     WHERE ${cond.join(" AND ")} ORDER BY ${order} LIMIT 100`,
    b.p,
  );
  return rows.map(toItem);
}

export async function approvalDetail(id: string) {
  await connectDB();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const [a] = await q<WithId<ApprovalDoc>>("SELECT * FROM approvals WHERE id = $1", [id]);
  if (!a) return null;
  const [c] = await q<WithId<CaseDoc>>("SELECT * FROM cases WHERE id = $1", [a.caseId]);
  return { approval: a, case: c ?? null };
}

// ---------------------------------------------------------------------------
// Management dashboard
// ---------------------------------------------------------------------------
export interface DashFilter {
  from?: string;
  to?: string;
  courier?: string;
  client?: string;
}

type Sum = { amount: number; n: number };

export async function managementDashboard(f: DashFilter) {
  await connectDB();
  const from = f.from ? new Date(`${f.from}T00:00:00Z`) : null;
  const to = f.to ? new Date(`${f.to}T23:59:59.999Z`) : null;

  /** AND-clauses for a table: courier/client filters (when the table has them) and the period on `dateCol`. */
  const where = (b: ReturnType<typeof params>, o: { dateCol?: string; courier?: string; client?: string }) => {
    let sql = "";
    if (o.courier && f.courier) sql += ` AND ${o.courier} = ${b.add(f.courier)}`;
    if (o.client && f.client) sql += ` AND ${o.client} = ${b.add(f.client)}`;
    if (o.dateCol && from) sql += ` AND ${o.dateCol} >= ${b.add(from)}`;
    if (o.dateCol && to) sql += ` AND ${o.dateCol} <= ${b.add(to)}`;
    return sql;
  };
  const run = <T>(build: (b: ReturnType<typeof params>) => string) => {
    const b = params();
    return q<T>(build(b), b.p);
  };

  const [
    issued, released, pending, unsettled, clientIssued, issuable, recovery, gap, gapExc, e2e,
    pipeline, byAge, scorecard, clientView, byMonth, decisions, banner,
  ] = await Promise.all([
    run<Sum>((b) => `SELECT COALESCE(SUM(total_amount), 0) AS amount, COALESCE(SUM(jsonb_array_length(lines)), 0)::int AS n FROM courier_cns WHERE TRUE${where(b, { dateCol: "cn_date", courier: "courier" })}`),
    run<Sum & { orders: number }>((b) => `SELECT COALESCE(SUM(amount), 0) AS amount, count(DISTINCT courier_cn_id)::int AS n, (SELECT COALESCE(SUM(jsonb_array_length(lines)), 0)::int FROM courier_cns WHERE id IN (SELECT courier_cn_id FROM settlements WHERE TRUE${where(b, { dateCol: "settled_on", courier: "courier" })})) AS orders FROM settlements WHERE TRUE${where(b, { dateCol: "settled_on", courier: "courier" })}`),
    run<Sum>((b) => `SELECT COALESCE(SUM(courier_liability), 0) AS amount, count(*)::int AS n FROM cases WHERE is_open AND courier_cn_amount <= 0${where(b, { courier: "courier", client: "client" })}`),
    run<Sum>((b) => `SELECT COALESCE(SUM(total_amount - settled_amount), 0) AS amount, COALESCE(SUM(jsonb_array_length(lines)), 0)::int AS n FROM courier_cns WHERE settlement_state <> 'SETTLED'${where(b, { courier: "courier" })}`),
    run<Sum>((b) => `SELECT COALESCE(SUM(client_cn_amount), 0) AS amount, count(*)::int AS n FROM cases WHERE client_cn_number IS NOT NULL${where(b, { dateCol: "released_at", courier: "courier", client: "client" })}`),
    run<Sum>((b) => `SELECT COALESCE(SUM(client_liability), 0) AS amount, count(*)::int AS n FROM cases WHERE is_open AND client_cn_number IS NULL${where(b, { courier: "courier", client: "client" })}`),
    run<{ cn: number; brand: number; n: number }>((b) => `SELECT COALESCE(SUM(courier_cn_amount), 0) AS cn, COALESCE(SUM(client_cn_amount), 0) AS brand, count(*)::int AS n FROM cases WHERE client_cn_number IS NOT NULL${where(b, { dateCol: "released_at", courier: "courier", client: "client" })}`),
    run<{ amount: number }>((b) => `SELECT COALESCE(SUM(sd_gap), 0) AS amount FROM cases WHERE client_cn_number IS NOT NULL${where(b, { dateCol: "released_at", courier: "courier", client: "client" })}`),
    run<Sum>((b) => `SELECT COALESCE(SUM(sd_gap), 0) AS amount, count(*)::int AS n FROM cases WHERE client_cn_number IS NOT NULL AND (committed_before_cn OR approval_ref IS NOT NULL)${where(b, { dateCol: "released_at", courier: "courier", client: "client" })}`),
    run<{ toBrand: number | null; toCn: number | null }>((b) => `SELECT AVG(EXTRACT(EPOCH FROM (released_at - marked_at)) / 86400) AS to_brand, (SELECT AVG(EXTRACT(EPOCH FROM (courier_cn_recorded_at - marked_at)) / 86400) FROM cases WHERE courier_cn_recorded_at IS NOT NULL${where(b, { dateCol: "marked_at", courier: "courier", client: "client" })}) AS to_cn FROM cases WHERE client_cn_number IS NOT NULL${where(b, { dateCol: "released_at", courier: "courier", client: "client" })}`),
    run<{ marked: number; claim: number; cn: number; brand: number; found: number; loss: number; rejected: number }>((b) => `SELECT count(*)::int AS marked, count(*) FILTER (WHERE claim_raised_at IS NOT NULL)::int AS claim, count(*) FILTER (WHERE courier_cn_amount > 0)::int AS cn, count(*) FILTER (WHERE client_cn_number IS NOT NULL)::int AS brand, count(*) FILTER (WHERE close_reason = 'FOUND')::int AS found, count(*) FILTER (WHERE close_reason = 'SD_DECISION_NO_PAYOUT')::int AS loss, count(*) FILTER (WHERE status = 'COURIER_REJECTED' AND is_open)::int AS rejected FROM cases WHERE TRUE${where(b, { dateCol: "marked_at", courier: "courier", client: "client" })}`),
    run<{ bucket: number; amount: number; n: number }>((b) => `SELECT bucket, COALESCE(SUM(bal), 0) AS amount, count(*)::int AS n FROM (
        SELECT CASE WHEN age <= 15 THEN 0 WHEN age <= 30 THEN 1 WHEN age <= 60 THEN 2 ELSE 3 END AS bucket, bal FROM (
          SELECT floor(EXTRACT(EPOCH FROM (now() - c.marked_at)) / 86400) AS age,
                 (l.amount * (cn.total_amount - cn.settled_amount) / NULLIF(cn.total_amount, 0)) AS bal
          FROM courier_cns cn
          CROSS JOIN LATERAL jsonb_to_recordset(cn.lines) AS l("caseId" uuid, amount numeric)
          JOIN cases c ON c.id = l."caseId"
          WHERE cn.settlement_state <> 'SETTLED'${where(b, { courier: "cn.courier" })}
        ) x
      ) y GROUP BY bucket ORDER BY bucket`),
    run<{ courier: string; open: number; pendingCn: number; recCn: number; recBrand: number; avgDays: number | null; rejected: number; total: number; gap: number }>((b) => `SELECT courier,
        count(*) FILTER (WHERE is_open AND client_cn_number IS NULL)::int AS open,
        COALESCE(SUM(courier_liability) FILTER (WHERE is_open AND courier_cn_amount <= 0), 0) AS pending_cn,
        COALESCE(SUM(courier_cn_amount) FILTER (WHERE client_cn_number IS NOT NULL), 0) AS rec_cn,
        COALESCE(SUM(client_cn_amount) FILTER (WHERE client_cn_number IS NOT NULL), 0) AS rec_brand,
        AVG(EXTRACT(EPOCH FROM (courier_cn_recorded_at - marked_at)) / 86400) AS avg_days,
        count(*) FILTER (WHERE status = 'COURIER_REJECTED')::int AS rejected,
        count(*)::int AS total,
        COALESCE(SUM(sd_gap) FILTER (WHERE client_cn_number IS NOT NULL), 0) AS gap
      FROM cases WHERE TRUE${where(b, { dateCol: "marked_at", courier: "courier", client: "client" })}
      GROUP BY courier ORDER BY open DESC, courier`),
    run<{ client: string; issuable: number; rel: number; gap: number }>((b) => `SELECT client,
        COALESCE(SUM(client_liability) FILTER (WHERE is_open AND client_cn_number IS NULL), 0) AS issuable,
        COALESCE(SUM(client_cn_amount) FILTER (WHERE client_cn_number IS NOT NULL${from ? ` AND released_at >= ${b.add(from)}` : ""}${to ? ` AND released_at <= ${b.add(to)}` : ""}), 0) AS rel,
        COALESCE(SUM(sd_gap) FILTER (WHERE client_cn_number IS NOT NULL${from ? ` AND released_at >= ${b.add(from)}` : ""}${to ? ` AND released_at <= ${b.add(to)}` : ""}), 0) AS gap
      FROM cases WHERE TRUE${where(b, { courier: "courier", client: "client" })} GROUP BY client ORDER BY issuable DESC, client`),
    q<{ month: string; gap: number }>(
      `SELECT to_char(date_trunc('month', released_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month, COALESCE(SUM(sd_gap), 0) AS gap
       FROM client_cns WHERE released_at >= date_trunc('month', now()) - interval '3 months' GROUP BY 1 ORDER BY 1`,
    ),
    run<{ approved: number; approvedAmt: number; rejected: number; avgDays: number | null }>((b) => `SELECT count(*) FILTER (WHERE status = 'APPROVED')::int AS approved,
        COALESCE(SUM(requested_amount) FILTER (WHERE status = 'APPROVED'), 0) AS approved_amt,
        count(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
        AVG(EXTRACT(EPOCH FROM ((decided->>'at')::timestamptz - created_at)) / 86400) AS avg_days
      FROM approvals WHERE status <> 'PENDING'${where(b, { dateCol: "created_at", courier: "courier", client: "client" })}`),
    approvalCounts(),
  ]);

  const rec = recovery[0];
  const issuedTotal = clientIssued[0];
  // Last four calendar months, even when a month has no releases.
  const now = new Date();
  const months = [3, 2, 1, 0].map((i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    return { key, label: monthShort(key) + (i === 0 ? " (to date)" : ""), gap: byMonth.find((m) => m.month === key)?.gap ?? 0 };
  });
  const top = clientView.slice(0, 4);
  const rest = clientView.slice(4);
  const clients = [
    ...top,
    ...(rest.length
      ? [{ client: `Others (${rest.length} client${rest.length === 1 ? "" : "s"})`, issuable: rest.reduce((s, r) => s + r.issuable, 0), rel: rest.reduce((s, r) => s + r.rel, 0), gap: rest.reduce((s, r) => s + r.gap, 0) }]
      : []),
  ];
  const duesRows = await q<{ name: string; dues: number }>("SELECT name, dues FROM clients WHERE dues > 0");
  const duesBy = new Map(duesRows.map((d) => [d.name, d.dues]));

  return {
    banner,
    courierCnIssued: issued[0],
    courierCnReleased: { amount: released[0].amount, orders: released[0].orders },
    notReleased: unsettled[0],
    courierCnReceivable: pending[0],
    clientCnIssued: issuedTotal,
    clientCnIssuable: issuable[0],
    recovery: { pct: rec.brand > 0 ? Math.round((rec.cn / rec.brand) * 1000) / 10 : null, cn: rec.cn, brand: rec.brand },
    sdGap: { amount: gap[0].amount, cases: rec.n, viaExceptions: gapExc[0].amount },
    e2e: { toBrand: e2e[0].toBrand == null ? null : Math.round(e2e[0].toBrand), toCn: e2e[0].toCn == null ? null : Math.round(e2e[0].toCn) },
    pipeline: pipeline[0],
    byAge: [0, 1, 2, 3].map((i) => ({ bucket: i, label: ["0–15 d", "16–30 d", "31–60 d", "60+ d"][i], amount: byAge.find((a) => a.bucket === i)?.amount ?? 0, n: byAge.find((a) => a.bucket === i)?.n ?? 0 })),
    scorecard: scorecard.map((s) => ({
      courier: s.courier,
      open: s.open,
      pendingCn: s.pendingCn,
      recovery: s.recBrand > 0 ? Math.round((s.recCn / s.recBrand) * 1000) / 10 : null,
      avgDays: s.avgDays == null ? null : Math.round(s.avgDays),
      rejectionRate: s.total ? Math.round((s.rejected / s.total) * 100) : 0,
      gap: s.gap,
    })),
    clients: clients.map((c) => ({ ...c, dues: duesBy.get(c.client) ?? 0 })),
    clientTotals: {
      issuable: clientView.reduce((s, r) => s + r.issuable, 0),
      rel: clientView.reduce((s, r) => s + r.rel, 0),
      gap: clientView.reduce((s, r) => s + r.gap, 0),
      dues: clientView.reduce((s, r) => s + (duesBy.get(r.client) ?? 0), 0),
    },
    months,
    decisions: decisions[0],
  };
}

export async function dashboardChoices() {
  await connectDB();
  const [couriers, clients] = await Promise.all([
    q<{ v: string }>("SELECT DISTINCT courier AS v FROM cases ORDER BY 1"),
    q<{ v: string }>("SELECT DISTINCT client AS v FROM cases ORDER BY 1"),
  ]);
  return { couriers: couriers.map((r) => r.v), clients: clients.map((r) => r.v) };
}
