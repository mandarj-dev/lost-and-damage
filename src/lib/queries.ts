// Read models for the OPS and Accounts case lists, group views, KPIs and the case detail.

import { connectDB, q } from "./db";
import { ticketChip, type CaseRow } from "./case-view";
import { daysBetween } from "./rules";
import type {
  ApprovalDoc,
  CaseDoc,
  ClientCNDoc,
  ClientDoc,
  CourierCNDoc,
  SettlementDoc,
  TimelineEventDoc,
  WithId,
} from "@/models";

export const OPS_SCOPES = ["open", "closed"] as const;
export const ACCOUNTS_SCOPES = ["ready", "await", "approval", "released"] as const;
export type OpsScope = (typeof OPS_SCOPES)[number];
export type AccountsScope = (typeof ACCOUNTS_SCOPES)[number];
export type Scope = OpsScope | AccountsScope;
export const PAGE_SIZE = 10;

/** SQL for each bucket. "Released" from OPS's view means the brand CN is out: OPS is done with it. */
export const SCOPE_SQL: Record<Scope, string> = {
  open: "is_open AND (client_cn_number IS NULL OR (committed_before_cn AND courier_cn_amount <= 0))",
  closed: "(NOT is_open OR (client_cn_number IS NOT NULL AND NOT (committed_before_cn AND courier_cn_amount <= 0)))",
  ready:
    "is_open AND client_cn_number IS NULL AND NOT returned_to_ops AND status <> 'PENDING_APPROVAL' AND (courier_cn_amount > 0 OR release_approved)",
  await:
    "is_open AND client_cn_number IS NULL AND status <> 'PENDING_APPROVAL' AND (returned_to_ops OR (courier_cn_amount <= 0 AND NOT release_approved))",
  approval: "is_open AND client_cn_number IS NULL AND status = 'PENDING_APPROVAL'",
  released: "(NOT is_open OR client_cn_number IS NOT NULL)",
};

export interface ListQuery {
  scope: Scope;
  type?: "LOST" | "DAMAGED";
  source?: "API" | "MANUAL";
  courier?: string;
  client?: string;
  ticket?: string; // open | claim | followup | rejected | escalated | returned
  from?: string; // marked from (YYYY-MM-DD)
  to?: string;
  search?: string; // one or many AWB / order / CN numbers
  dues?: string; // "gt30": only clients with receivables older than 30 days
  page?: number;
}

const TICKET_SQL: Record<string, string> = {
  open: "status = 'MARKED'",
  claim: "status = 'CLAIM_RAISED'",
  followup: "status = 'FOLLOW_UP'",
  rejected: "status = 'COURIER_REJECTED'",
  escalated: "status = 'ESCALATED'",
  returned: "returned_to_ops",
};

function validDate(s: string | undefined, endOfDay = false): Date | null {
  if (!s) return null;
  const d = new Date(endOfDay ? `${s}T23:59:59.999Z` : `${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Build the WHERE clause (and its parameters) for the case lists. */
export function caseWhere(qy: ListQuery, opts: { ignoreType?: boolean } = {}): { where: string; params: unknown[] } {
  const cond: string[] = [SCOPE_SQL[qy.scope] ?? SCOPE_SQL.open];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    cond.push(sql.replace("?", `$${params.length}`));
  };
  if (qy.type && !opts.ignoreType) add("type = ?", qy.type);
  if (qy.source) add("source = ?", qy.source);
  if (qy.courier) add("courier = ?", qy.courier);
  if (qy.client) add("client = ?", qy.client);
  if (qy.ticket && TICKET_SQL[qy.ticket]) cond.push(TICKET_SQL[qy.ticket]);
  const from = validDate(qy.from);
  const to = validDate(qy.to, true);
  if (from) add("marked_at >= ?", from);
  if (to) add("marked_at <= ?", to);
  if (qy.dues === "gt30") cond.push("client IN (SELECT name FROM clients WHERE dues > 0 AND dues_age_days >= 30)");
  const tokens = (qy.search ?? "").split(/[\s,;]+/).filter(Boolean).slice(0, 200);
  if (tokens.length) {
    params.push(tokens);
    const n = `$${params.length}::text[]`;
    cond.push(`(awb = ANY(${n}) OR order_id = ANY(${n}) OR courier_cn_numbers && ${n} OR client_cn_number = ANY(${n}))`);
  }
  return { where: cond.join(" AND "), params };
}

/** Read the shared filters out of a Next.js searchParams object. */
export function parseListQuery(sp: Record<string, string | undefined>, scope: Scope): ListQuery {
  return {
    scope,
    type: sp.type === "LOST" || sp.type === "DAMAGED" ? sp.type : undefined,
    source: sp.source === "API" || sp.source === "MANUAL" ? sp.source : undefined,
    courier: sp.courier || undefined,
    client: sp.client || undefined,
    ticket: sp.ticket || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
    search: sp.q || undefined,
    dues: sp.dues || undefined,
    page: Math.max(Number(sp.page ?? 1) || 1, 1),
  };
}

// ---------------------------------------------------------------------------
// Case rows (what the list tables render). Plain objects: safe to hand to client components.
// ---------------------------------------------------------------------------
export type { CaseRow };

const LAST_ACTION_LABEL: Record<string, string> = {
  CLAIM_SENT: "Claim email",
  FOLLOW_UP: "Follow-up",
  CN_REJECTED: "Rejection recorded",
  ESCALATED: "Escalated",
  AUTO_ESCALATED: "Escalated",
  COURIER_CN_RECORDED: "Courier CN",
};

export async function decorate(rows: WithId<CaseDoc>[]): Promise<CaseRow[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r._id);
  const cnNumbers = [...new Set(rows.flatMap((r) => r.courierCnNumbers ?? []))];
  const [clients, cns, actions, approvals] = await Promise.all([
    q<ClientDoc>("SELECT * FROM clients WHERE name = ANY($1::text[])", [[...new Set(rows.map((r) => r.client))]]),
    cnNumbers.length
      ? q<WithId<CourierCNDoc>>("SELECT * FROM courier_cns WHERE cn_number = ANY($1::text[])", [cnNumbers])
      : Promise.resolve([] as WithId<CourierCNDoc>[]),
    q<{ caseId: string; action: string; by: { name: string; role: string }; createdAt: Date }>(
      `SELECT DISTINCT ON (case_id) case_id, action, "by", created_at FROM timeline_events
       WHERE case_id = ANY($1::uuid[]) AND action IN ('CLAIM_SENT','FOLLOW_UP','CN_REJECTED','ESCALATED','AUTO_ESCALATED','COURIER_CN_RECORDED')
       ORDER BY case_id, created_at DESC`,
      [ids],
    ),
    q<WithId<ApprovalDoc>>(
      "SELECT DISTINCT ON (case_id) * FROM approvals WHERE case_id = ANY($1::uuid[]) AND status = 'PENDING' ORDER BY case_id, created_at DESC",
      [ids],
    ),
  ]);
  const duesBy = new Map(clients.map((c) => [c.name, c]));
  const cnByNo = new Map(cns.map((c) => [c.cnNumber, c]));
  const actionBy = new Map(actions.map((a) => [a.caseId, a]));
  const approvalBy = new Map(approvals.map((a) => [a.caseId, a]));
  const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : "");

  return rows.map((c) => {
    const cnNo = c.courierCnNumbers?.length ? c.courierCnNumbers[c.courierCnNumbers.length - 1] : null;
    const cn = cnNo ? cnByNo.get(cnNo) : undefined;
    const act = actionBy.get(c._id);
    const ap = approvalBy.get(c._id);
    return {
      id: c._id,
      caseNo: c.caseNo,
      awb: c.awb,
      orderId: c.orderId ?? null,
      client: c.client,
      courier: c.courier,
      type: c.type,
      source: c.source,
      status: c.status,
      isOpen: c.isOpen,
      markedAt: iso(c.markedAt),
      markedBy: c.source === "API" ? "Courier API" : c.marked.name,
      markedByRole: c.marked.role,
      ageDays: daysBetween(c.markedAt),
      itemValue: c.itemValue,
      clientLiability: c.clientLiability,
      courierLiability: c.courierLiability,
      courierCnAmount: c.courierCnAmount ?? 0,
      sdGap: Math.max(0, c.clientLiability - (c.courierCnAmount ?? 0)),
      returnedToOps: c.returnedToOps,
      releaseApproved: c.releaseApproved,
      committedBeforeCn: c.committedBeforeCn,
      duesAmount: duesBy.get(c.client)?.dues ?? 0,
      duesAgeDays: duesBy.get(c.client)?.duesAgeDays ?? 0,
      chip: ticketChip(c),
      courierCn: cn
        ? {
            number: cn.cnNumber,
            date: iso(cn.cnDate),
            by: cn.recorded.name,
            byRole: cn.recorded.role,
            settlement: cn.settlementState,
            settled: cn.settledAmount,
            total: cn.totalAmount,
          }
        : null,
      clientCn: c.clientCnNumber ? { number: c.clientCnNumber, date: iso(c.releasedAt) || null, amount: c.clientCnAmount } : null,
      approval: ap
        ? { ref: ap.ref ?? null, type: ap.exceptionType ?? null, amount: ap.requestedAmount, since: iso(ap.createdAt), by: ap.requested.name, kind: ap.kind }
        : null,
      lastAction: act
        ? { label: LAST_ACTION_LABEL[act.action] ?? act.action, at: iso(act.createdAt), by: act.by.name, role: act.by.role }
        : null,
    };
  });
}

export async function listCaseRows(qy: ListQuery) {
  await connectDB();
  const page = Math.max(qy.page ?? 1, 1);
  const { where, params } = caseWhere(qy);
  const [rows, total] = await Promise.all([
    q<WithId<CaseDoc>>(
      `SELECT * FROM cases WHERE ${where} ORDER BY marked_at DESC, awb LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
      params,
    ),
    countCases(qy),
  ]);
  return { rows: await decorate(rows), total, page, pageSize: PAGE_SIZE };
}

export async function countCases(qy: ListQuery, opts: { ignoreType?: boolean } = {}): Promise<number> {
  const { where, params } = caseWhere(qy, opts);
  const [r] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM cases WHERE ${where}`, params);
  return r?.n ?? 0;
}

/** Counts for the All / Lost / Damage sub-tabs (ignores the type filter itself). */
export async function typeCounts(qy: ListQuery) {
  const { where, params } = caseWhere(qy, { ignoreType: true });
  const rows = await q<{ type: string; n: number }>(`SELECT type, count(*)::int AS n FROM cases WHERE ${where} GROUP BY type`, params);
  const lost = rows.find((r) => r.type === "LOST")?.n ?? 0;
  const damage = rows.find((r) => r.type === "DAMAGED")?.n ?? 0;
  return { all: lost + damage, lost, damage };
}

export async function distinctValues(col: "courier" | "client"): Promise<string[]> {
  await connectDB();
  const rows = await q<{ v: string }>(`SELECT DISTINCT ${col} AS v FROM cases ORDER BY ${col}`);
  return rows.map((r) => r.v);
}

export async function caseIdsByAwb(awbs: string[]): Promise<Map<string, string>> {
  const rows = await q<{ _id: string; awb: string }>("SELECT id, awb FROM cases WHERE awb = ANY($1::text[])", [awbs]);
  return new Map(rows.map((r) => [r.awb, r._id]));
}

// ---------------------------------------------------------------------------
// Group views (View by Courier / Client)
// ---------------------------------------------------------------------------
export interface GroupRow {
  key: string;
  cases: number;
  lost: number;
  damage: number;
  claimValue: number;
  brandLiability: number;
  courierCn: number;
  sdGap: number;
  cnRecent: number;
  rejected: number;
  avgAge: number;
  oldest: number;
  duesAmount: number;
  duesAge: number;
}

export async function groupCases(qy: ListQuery, by: "courier" | "client"): Promise<GroupRow[]> {
  await connectDB();
  const { where, params } = caseWhere(qy);
  const col = by === "courier" ? "courier" : "client";
  const rows = await q<Record<string, number | string>>(
    `SELECT ${col} AS grp_key,
       count(*)::int AS case_count,
       count(*) FILTER (WHERE type = 'LOST')::int AS lost,
       count(*) FILTER (WHERE type = 'DAMAGED')::int AS damage,
       COALESCE(SUM(courier_liability), 0) AS claim_value,
       COALESCE(SUM(client_liability), 0) AS brand_liability,
       COALESCE(SUM(courier_cn_amount), 0) AS courier_cn,
       COALESCE(SUM(GREATEST(client_liability - courier_cn_amount, 0)), 0) AS sd_gap,
       COALESCE(SUM(courier_cn_amount) FILTER (WHERE courier_cn_recorded_at >= now() - interval '30 days'), 0) AS cn_recent,
       count(*) FILTER (WHERE status = 'COURIER_REJECTED')::int AS rejected,
       COALESCE(AVG(EXTRACT(EPOCH FROM (now() - marked_at)) / 86400), 0) AS avg_age,
       COALESCE(MAX(EXTRACT(EPOCH FROM (now() - COALESCE(courier_cn_recorded_at, marked_at))) / 86400), 0) AS oldest
     FROM cases
     WHERE ${where}
     GROUP BY ${col}
     ORDER BY case_count DESC, grp_key`,
    params,
  );
  const dues = by === "client" && rows.length
    ? await q<ClientDoc>("SELECT * FROM clients WHERE name = ANY($1::text[])", [rows.map((r) => String(r.grpKey))])
    : [];
  const duesBy = new Map(dues.map((d) => [d.name, d]));
  return rows.map((x) => ({
    key: String(x.grpKey),
    cases: Number(x.caseCount),
    lost: Number(x.lost),
    damage: Number(x.damage),
    claimValue: Number(x.claimValue),
    brandLiability: Number(x.brandLiability),
    courierCn: Number(x.courierCn),
    sdGap: Number(x.sdGap),
    cnRecent: Number(x.cnRecent),
    rejected: Number(x.rejected),
    avgAge: Math.round(Number(x.avgAge)),
    oldest: Math.round(Number(x.oldest)),
    duesAmount: duesBy.get(String(x.grpKey))?.dues ?? 0,
    duesAge: duesBy.get(String(x.grpKey))?.duesAgeDays ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------
export async function opsKpis() {
  await connectDB();
  const [open] = await q<{ open: number; lost: number; damage: number; api: number; claimValue: number; couriers: number; windowSoon: number }>(
    `SELECT count(*)::int AS open,
       count(*) FILTER (WHERE type = 'LOST')::int AS lost,
       count(*) FILTER (WHERE type = 'DAMAGED')::int AS damage,
       count(*) FILTER (WHERE source = 'API')::int AS api,
       COALESCE(SUM(courier_liability), 0) AS claim_value,
       count(DISTINCT courier)::int AS couriers,
       count(*) FILTER (WHERE claim_raised_at IS NULL AND COALESCE(picked_up_at, marked_at) + interval '30 days' <= now() + interval '7 days')::int AS window_soon
     FROM cases WHERE ${SCOPE_SQL.open}`,
  );
  const [cn] = await q<{ amount: number; n: number }>(
    "SELECT COALESCE(SUM(courier_cn_amount), 0) AS amount, count(*)::int AS n FROM cases WHERE courier_cn_recorded_at >= now() - interval '30 days'",
  );
  const [closed] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM cases WHERE ${SCOPE_SQL.closed}`);
  return { ...open, cn30Amount: cn.amount, cn30Cases: cn.n, closed: closed.n };
}

export async function accountsKpis() {
  await connectDB();
  const [c] = await q<Record<string, number>>(
    `SELECT
       count(*) FILTER (WHERE ${SCOPE_SQL.ready})::int AS ready_n,
       COALESCE(SUM(client_liability) FILTER (WHERE ${SCOPE_SQL.ready}), 0) AS ready_amt,
       COALESCE(SUM(GREATEST(client_liability - courier_cn_amount, 0)) FILTER (WHERE ${SCOPE_SQL.ready}), 0) AS ready_gap,
       count(*) FILTER (WHERE ${SCOPE_SQL.ready} AND courier_cn_recorded_at < now() - interval '7 days')::int AS ready_old,
       count(*) FILTER (WHERE ${SCOPE_SQL.await})::int AS await_n,
       COALESCE(SUM(client_liability) FILTER (WHERE ${SCOPE_SQL.await}), 0) AS await_amt,
       COALESCE(SUM(courier_liability) FILTER (WHERE ${SCOPE_SQL.await}), 0) AS await_claim,
       count(*) FILTER (WHERE ${SCOPE_SQL.await} AND source = 'API')::int AS await_api,
       count(*) FILTER (WHERE ${SCOPE_SQL.await} AND source = 'MANUAL')::int AS await_ops,
       count(*) FILTER (WHERE is_open AND courier_cn_amount <= 0)::int AS pend_n,
       COALESCE(SUM(courier_liability) FILTER (WHERE is_open AND courier_cn_amount <= 0), 0) AS pend_amt,
       count(*) FILTER (WHERE ${SCOPE_SQL.approval})::int AS appr_n,
       COALESCE(SUM(client_liability) FILTER (WHERE ${SCOPE_SQL.approval}), 0) AS appr_amt,
       count(*) FILTER (WHERE ${SCOPE_SQL.released})::int AS released_n
     FROM cases`,
  );
  const [ap] = await q<{ noCn: number; above: number; amount: number }>(
    `SELECT count(*) FILTER (WHERE 'NO_COURIER_CN' = ANY(reasons))::int AS no_cn,
            count(*) FILTER (WHERE 'ABOVE_BRAND_LIABILITY' = ANY(reasons))::int AS above,
            COALESCE(SUM(requested_amount), 0) AS amount
     FROM approvals WHERE status = 'PENDING' AND kind = 'APPROVAL'`,
  );
  const [unsettled] = await q<{ amount: number; orders: number; cns: number }>(
    `SELECT COALESCE(SUM(total_amount - settled_amount), 0) AS amount,
            COALESCE(SUM(jsonb_array_length(lines)), 0)::int AS orders, count(*)::int AS cns
     FROM courier_cns WHERE settlement_state <> 'SETTLED'`,
  );
  const [released30] = await q<{ amount: number; n: number }>(
    "SELECT COALESCE(SUM(amount), 0) AS amount, count(*)::int AS n FROM client_cns WHERE released_at >= now() - interval '30 days'",
  );
  const x = c as unknown as Record<string, number>;
  return {
    readyN: x.readyN, readyAmt: x.readyAmt, readyGap: x.readyGap, readyOld: x.readyOld,
    awaitN: x.awaitN, awaitAmt: x.awaitAmt, awaitClaim: x.awaitClaim, awaitApi: x.awaitApi, awaitOps: x.awaitOps,
    apprN: x.apprN, apprAmt: x.apprAmt, releasedN: x.releasedN,
    noCn: ap?.noCn ?? 0, above: ap?.above ?? 0,
    unsettledAmt: unsettled.amount, unsettledOrders: unsettled.orders, unsettledCns: unsettled.cns,
    released30Amt: released30.amount, released30N: released30.n,
    pendN: x.pendN, pendAmt: x.pendAmt,
    receivableAmt: x.pendAmt + unsettled.amount,
    receivableOrders: x.pendN + unsettled.orders,
    issuableAmt: x.readyAmt + x.awaitAmt + x.apprAmt,
    issuableOrders: x.readyN + x.awaitN + x.apprN,
  };
}

// ---------------------------------------------------------------------------
// Case detail
// ---------------------------------------------------------------------------
export async function getCaseDetail(id: string) {
  await connectDB();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const [c] = await q<WithId<CaseDoc>>("SELECT * FROM cases WHERE id = $1", [id]);
  if (!c) return null;
  const [client, timeline, courierCns, clientCns, approvals] = await Promise.all([
    q<ClientDoc>("SELECT * FROM clients WHERE name = $1", [c.client]).then((r) => r[0] ?? null),
    q<WithId<TimelineEventDoc>>("SELECT * FROM timeline_events WHERE case_id = $1 ORDER BY created_at DESC", [id]),
    q<WithId<CourierCNDoc>>("SELECT * FROM courier_cns WHERE lines @> $1::jsonb ORDER BY cn_date DESC", [JSON.stringify([{ caseId: id }])]),
    q<WithId<ClientCNDoc>>("SELECT * FROM client_cns WHERE case_id = $1", [id]),
    q<WithId<ApprovalDoc>>("SELECT * FROM approvals WHERE case_id = $1 ORDER BY created_at DESC", [id]),
  ]);
  const settlements = courierCns.length
    ? await q<WithId<SettlementDoc>>(
        "SELECT * FROM settlements WHERE courier_cn_id = ANY($1::uuid[]) ORDER BY settled_on DESC",
        [courierCns.map((x) => x._id)],
      )
    : [];
  return { case: c, client, timeline, courierCns, clientCn: clientCns[0] ?? null, approvals, settlements };
}

/** Rows for the CSV behind "Export view". */
export async function exportRows(qy: ListQuery) {
  await connectDB();
  const { where, params } = caseWhere(qy);
  const rows = await q<WithId<CaseDoc>>(
    `SELECT * FROM cases WHERE ${where} ORDER BY marked_at DESC, awb LIMIT 5000`,
    params,
  );
  return decorate(rows);
}
