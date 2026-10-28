import { AsyncLocalStorage } from "node:async_hooks";
import { cookies } from "next/headers";
import { Pool, types } from "pg";
import { DEV_COOKIE, SANDBOX_ID, parseDevCookie } from "./session";

// Postgres returns numeric and bigint (count) as strings; the app wants numbers.
types.setTypeParser(1700, (v: string) => parseFloat(v));
types.setTypeParser(20, (v: string) => parseInt(v, 10));

/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Db = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

// Tables are created on first use, so a fresh (empty) Neon database just works.
const DDL = `
CREATE TABLE IF NOT EXISTS cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  awb text NOT NULL UNIQUE,
  order_id text,
  client text NOT NULL,
  courier text NOT NULL,
  type text NOT NULL,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'MARKED',
  ticket_status text,
  claim_ref text,
  item_value numeric(14,2) NOT NULL,
  client_liability numeric(14,2) NOT NULL,
  courier_liability numeric(14,2) NOT NULL DEFAULT 0,
  courier_cn_amount numeric(14,2) NOT NULL DEFAULT 0,
  courier_cn_numbers text[] NOT NULL DEFAULT '{}',
  client_cn_amount numeric(14,2) NOT NULL DEFAULT 0,
  client_cn_number text,
  sd_gap numeric(14,2) NOT NULL DEFAULT 0,
  is_open boolean NOT NULL DEFAULT true,
  marked jsonb NOT NULL,
  marked_at timestamptz NOT NULL,
  last_update jsonb,
  courier_cn_recorded jsonb,
  courier_cn_recorded_at timestamptz,
  released jsonb,
  escalated_at timestamptz,
  closed jsonb,
  remarks text,
  evidence jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cases_open_idx ON cases (is_open, source, courier, marked_at DESC);
CREATE INDEX IF NOT EXISTS cases_status_idx ON cases (status);
CREATE INDEX IF NOT EXISTS cases_client_cn_idx ON cases (client_cn_number);
CREATE INDEX IF NOT EXISTS cases_cn_numbers_idx ON cases USING gin (courier_cn_numbers);

CREATE TABLE IF NOT EXISTS courier_cns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cn_number text NOT NULL,
  courier text NOT NULL,
  cn_date timestamptz NOT NULL,
  total_amount numeric(14,2) NOT NULL,
  lines jsonb NOT NULL,
  document jsonb,
  recorded jsonb NOT NULL,
  settled_amount numeric(14,2) NOT NULL DEFAULT 0,
  settlement_state text NOT NULL DEFAULT 'UNSETTLED',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (courier, cn_number)
);
CREATE INDEX IF NOT EXISTS courier_cns_lines_idx ON courier_cns USING gin (lines jsonb_path_ops);

CREATE TABLE IF NOT EXISTS client_cns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cn_number text NOT NULL UNIQUE,
  case_id uuid NOT NULL UNIQUE,
  awb text NOT NULL,
  client text NOT NULL,
  amount numeric(14,2) NOT NULL,
  courier_cn_amount_at_release numeric(14,2) NOT NULL DEFAULT 0,
  sd_gap numeric(14,2) NOT NULL DEFAULT 0,
  approval_id uuid,
  released jsonb NOT NULL,
  released_at timestamptz NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_cn_id uuid NOT NULL,
  cn_number text NOT NULL,
  courier text NOT NULL,
  mode text NOT NULL,
  utr text,
  adjustment_month text,
  freight_invoice_ref text,
  amount numeric(14,2) NOT NULL,
  settled_on timestamptz NOT NULL,
  proof jsonb,
  recorded jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS settlements_cn_idx ON settlements (courier_cn_id);

CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  awb text NOT NULL,
  client text,
  courier text,
  reasons text[] NOT NULL,
  requested_amount numeric(14,2) NOT NULL,
  client_liability numeric(14,2),
  courier_cn_amount numeric(14,2),
  sd_gap numeric(14,2),
  justification text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  requested jsonb NOT NULL,
  decided jsonb,
  decision_note text,
  consumed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approvals_case_idx ON approvals (case_id);
CREATE UNIQUE INDEX IF NOT EXISTS approvals_one_pending_idx ON approvals (case_id) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  action text NOT NULL,
  "by" jsonb NOT NULL,
  message text,
  data jsonb,
  attachments jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS timeline_case_idx ON timeline_events (case_id, created_at);

-- Client receivables (dues) shown as a warning when releasing a brand CN.
CREATE TABLE IF NOT EXISTS clients (
  name text PRIMARY KEY,
  dues numeric(14,2) NOT NULL DEFAULT 0,
  dues_age_days int NOT NULL DEFAULT 0
);

-- Columns added after the first release (kept idempotent so existing databases upgrade in place).
CREATE SEQUENCE IF NOT EXISTS ld_case_seq START 4790;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS case_no text DEFAULT ('LD-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('ld_case_seq')::text, 6, '0'));
ALTER TABLE cases ADD COLUMN IF NOT EXISTS product text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS picked_up_at timestamptz;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS last_scan text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS marking_reason text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS courier_remark text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS client_liability_cap numeric(14,2);
ALTER TABLE cases ADD COLUMN IF NOT EXISTS courier_liability_cap numeric(14,2);
ALTER TABLE cases ADD COLUMN IF NOT EXISTS claim_raised_at timestamptz;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS next_follow_up_at timestamptz;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS follow_up_count int NOT NULL DEFAULT 0;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS rejection_note text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS close_reason text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS returned_to_ops boolean NOT NULL DEFAULT false;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS return_reason text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS committed_before_cn boolean NOT NULL DEFAULT false;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS released_at timestamptz;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS approval_ref text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS release_approved boolean NOT NULL DEFAULT false;
ALTER TABLE courier_cns ADD COLUMN IF NOT EXISTS expected_mode text;
ALTER TABLE courier_cns ADD COLUMN IF NOT EXISTS expected_month text;
ALTER TABLE courier_cns ADD COLUMN IF NOT EXISTS chased_count int NOT NULL DEFAULT 0;
ALTER TABLE client_cns DROP CONSTRAINT IF EXISTS client_cns_cn_number_key;
ALTER TABLE client_cns ADD COLUMN IF NOT EXISTS cn_date timestamptz;
ALTER TABLE client_cns ADD COLUMN IF NOT EXISTS cn_total numeric(14,2);
ALTER TABLE client_cns ADD COLUMN IF NOT EXISTS documents jsonb NOT NULL DEFAULT '[]';
ALTER TABLE client_cns ADD COLUMN IF NOT EXISTS remarks text;
CREATE INDEX IF NOT EXISTS client_cns_cn_idx ON client_cns (cn_number);
CREATE SEQUENCE IF NOT EXISTS ld_approval_seq START 120;
DROP INDEX IF EXISTS settlements_utr_idx;
CREATE UNIQUE INDEX IF NOT EXISTS settlements_utr_cn_idx ON settlements (utr, courier_cn_id) WHERE utr IS NOT NULL;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS batch_id text;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS remarks text;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'APPROVAL';
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS exception_type text;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS approver text;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS needed_by timestamptz;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS documents jsonb NOT NULL DEFAULT '[]';
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS courier_position text;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS ref text;

CREATE TABLE IF NOT EXISTS demo_sessions (
  sid text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

// One pool per warm serverless instance / dev server.
const g = globalThis as unknown as { _pg?: { pool?: Pool; ready?: Promise<void> } };
const state = (g._pg ??= {});

function pool(): Pool {
  if (!state.pool) {
    const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Add a Neon Postgres store in Vercel, or copy .env.example to .env.local.");
    state.pool = new Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 5), idleTimeoutMillis: 10_000 });
  }
  return state.pool;
}

async function migrate() {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(727001)"); // two cold starts must not create tables at once
    await client.query(DDL);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

function ready(): Promise<void> {
  return (state.ready ??= migrate().catch((e) => {
    state.ready = undefined;
    throw e;
  }));
}

/** Make sure the database is reachable and the tables exist. */
export async function connectDB(): Promise<void> {
  await ready();
}

export async function closeDb() {
  await state.pool?.end();
  state.pool = undefined;
  state.ready = undefined;
}

// ---------------------------------------------------------------------------
// Row mapping: snake_case columns <-> camelCase fields, id -> _id
// ---------------------------------------------------------------------------
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

export function mapRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k === "id" ? "_id" : camel(k)] = v;
  return out as T;
}

// Columns stored as jsonb (everything else is a plain column; JS arrays map to text[]).
const JSON_COLS = new Set([
  "marked", "last_update", "courier_cn_recorded", "released", "closed", "evidence", "lines",
  "document", "recorded", "decided", "requested", "by", "data", "attachments", "proof", "documents",
]);
const encode = (col: string, v: unknown) => (JSON_COLS.has(snake(col)) && v != null ? JSON.stringify(v) : v);

// ---------------------------------------------------------------------------
// Demo sandboxes (AUTH_MODE=dev). Every dev login owns a private Postgres schema
// "demo_<sid>" holding copies of the six data tables, filled with dummy orders.
// Queries are pointed at it by qualifying the table names; logout drops the schema.
// ---------------------------------------------------------------------------
const DATA_TABLES = ["cases", "courier_cns", "client_cns", "settlements", "approvals", "timeline_events", "clients"];
const TABLE_REF = new RegExp(`\\b(FROM|INTO|UPDATE|JOIN)\\s+(${DATA_TABLES.join("|")})\\b`, "g");
const sandboxStore = new AsyncLocalStorage<string>();

/** Run `fn` with all queries going to the sandbox `sid` (used while creating, seeding and resetting). */
export function withSandbox<T>(sid: string, fn: () => Promise<T>): Promise<T> {
  return sandboxStore.run(sid, fn);
}

async function currentSandbox(): Promise<string | undefined> {
  const explicit = sandboxStore.getStore();
  if (explicit) return explicit;
  if (process.env.AUTH_MODE !== "dev") return undefined;
  try {
    return parseDevCookie((await cookies()).get(DEV_COOKIE)?.value)?.sid;
  } catch {
    return undefined; // not inside a request (cron, scripts)
  }
}

const schemaOf = (sid: string) => {
  if (!SANDBOX_ID.test(sid)) throw new Error("Invalid sandbox id");
  return `demo_${sid}`;
};

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = [], db?: Db): Promise<T[]> {
  await ready();
  const sid = await currentSandbox();
  const sql = sid
    ? text.replace(TABLE_REF, (_m, kw: string, table: string) => `${kw} "${schemaOf(sid)}".${table}`)
    : text;
  const target = (db ?? pool()) as unknown as Db;
  const res = await target.query(sql, params);
  return res.rows.map((r) => mapRow<T>(r));
}

export async function sandboxExists(sid: string): Promise<boolean> {
  await ready();
  // The last column added to `cases` doubles as a version marker: a sandbox built by an
  // older release lacks it and is treated as gone, so its owner gets a fresh one.
  const res = await pool().query(
    "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'cases' AND column_name = 'release_approved') AS ok",
    [schemaOf(sid)],
  );
  return Boolean(res.rows[0]?.ok);
}

// Per-instance cache so signed-in requests don't re-check that their sandbox exists.
const aliveSandboxes = new Set<string>();

export async function sandboxAlive(sid: string): Promise<boolean> {
  if (aliveSandboxes.has(sid)) return true;
  const ok = await sandboxExists(sid);
  if (ok) aliveSandboxes.add(sid);
  return ok;
}

/** Sandboxes older than this are removed the next time anyone starts a demo (tabs closed without logout). */
const SANDBOX_MAX_AGE = "6 hours";

export async function createSandbox(sid: string): Promise<void> {
  await ready();
  const schema = schemaOf(sid);
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    for (const t of DATA_TABLES)
      await client.query(`CREATE TABLE IF NOT EXISTS "${schema}".${t} (LIKE public.${t} INCLUDING ALL)`);
    await client.query("INSERT INTO public.demo_sessions (sid) VALUES ($1) ON CONFLICT DO NOTHING", [sid]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  const stale = await pool().query(`SELECT sid FROM public.demo_sessions WHERE created_at < now() - interval '${SANDBOX_MAX_AGE}'`);
  for (const row of stale.rows) await dropSandbox(String(row.sid));
}

export async function dropSandbox(sid: string): Promise<void> {
  await ready();
  aliveSandboxes.delete(sid);
  await pool().query(`DROP SCHEMA IF EXISTS "${schemaOf(sid)}" CASCADE`);
  await pool().query("DELETE FROM public.demo_sessions WHERE sid = $1", [sid]);
}

export async function insert<T = Record<string, unknown>>(table: string, obj: Record<string, unknown>, db?: Db): Promise<T> {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  const cols = entries.map(([k]) => `"${snake(k)}"`);
  const vals = entries.map(([k, v]) => encode(k, v));
  const marks = cols.map((_, i) => `$${i + 1}`);
  const [row] = await q<T>(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${marks.join(", ")}) RETURNING *`, vals, db);
  return row;
}

/** Update one row by id. Returns null when no row matched (including `onlyIf`). */
export async function update<T = Record<string, unknown>>(
  table: string,
  id: string,
  patch: Record<string, unknown>,
  db?: Db,
  onlyIf?: string,
): Promise<T | null> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  const sets = entries.map(([k], i) => `"${snake(k)}" = $${i + 2}`);
  const vals = entries.map(([k, v]) => encode(k, v));
  const rows = await q<T>(
    `UPDATE ${table} SET ${sets.join(", ")} WHERE id = $1${onlyIf ? ` AND ${onlyIf}` : ""} RETURNING *`,
    [id, ...vals],
    db,
  );
  return rows[0] ?? null;
}

/** Run work in a Postgres transaction. */
export async function withTransaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  await ready();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client as unknown as Db);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
