# InstaLogix · Lost & Damage Disputes

ShipDelight's internal app for Lost and Damaged shipment disputes. It replaces the WhatsApp, email and Excel process and closes a revenue leak: a brand could be paid before the courier had issued its credit note (CN).

Three panels, built to the Figma file "L&D Disputes – Screens":

- **OPS** marks cases, chases couriers and records courier CNs. Open / Closed cases, view by Courier / Client / AWB, Update status (one panel for one or many cases), Bulk update via Excel, case detail with audit trail.
- **Accounts** releases brand CNs (one brand CN for several cases of a client), requests exceptions, returns cases to OPS and records courier settlements.
- **Management** has the dashboard and decides approvals and escalations.

**Stack:** Next.js 15 (App Router, TypeScript), Tailwind 4 plus a small design system in `globals.css`, Postgres (Neon) via node-postgres, Vercel Blob for files, Vercel Cron for auto-escalation.

## Run locally

```bash
npm install
npm run dev:db            # terminal 1: a local Postgres (PGlite), nothing to install
# terminal 2 (PowerShell: $env:NAME = "value")
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres?sslmode=disable PG_POOL_MAX=1 AUTH_MODE=dev npm run dev
```

Or point `DATABASE_URL` at any Postgres (a free Neon database works). Tables are created on first request. File uploads need `BLOB_READ_WRITE_TOKEN` (a Vercel Blob store).

```bash
npm test                  # rule tests + the demo seed and every flow against a real Postgres (PGlite)
npm run lint && npm run typecheck && npm run build
```

## Demo sandbox (AUTH_MODE=dev)

With `AUTH_MODE=dev` every sign-in gets its own private Postgres schema (`demo_<id>`) with copies of the data tables, filled with about 40 dummy orders by `seedDemo()` in `src/lib/demo.ts` (backdated histories, approvals waiting, part-settled CNs, a case the brand was paid for before the courier CN, and so on). The **Demo sandbox** widget (bottom right) switches role without losing test data, runs the 15-day escalation on demand, resets the orders, or logs out, which drops the schema. Sandboxes left behind (tab closed without logging out) are removed after 6 hours, the next time someone starts a demo. `/demo` lists test scenarios by AWB. Leave `AUTH_MODE` empty in production: the app then uses the real tables and the InstaLogix sign-in (see `src/lib/auth.ts`).

## Deploy on Vercel

This tree is the **live-backend** frontend (see `README-LIVE-BACKEND.md`). It does not need Neon, Blob, or Cron.

1. Import the Git repo into Vercel (Framework Preset: Next.js).
2. Set `NEXT_PUBLIC_API_BASE_URL` to `https://smart-financeapi-dev.shipdelight.com` (Production + Preview).
3. Allow your Vercel origin(s) on the Smart-Finance API CORS allow-list.

## Business rules (`src/lib/rules.ts`, unit tested, enforced in `src/lib/services.ts`)

| Rule | Where |
|---|---|
| Manual cases belong to OPS, API-marked cases to Accounts. Accounts may only add follow-ups on OPS cases; OPS can only view API cases. | `allowedDispositions` |
| Brand CN release is locked until the courier CN is recorded, unless management approves an exception. | `evaluateRelease` |
| Release defaults to brand liability and SD gap = release – courier CN. Above brand liability needs management approval. | `evaluateRelease`, `releaseBrandCn` |
| Client dues are a warning, never a block. | `releaseBrandCn` |
| A consolidated courier CN is split per AWB, CN numbers are unique, a CN cannot exceed the claim and a short payment needs a reason. | `validateCnLines`, `applyDisposition` |
| Brand paid before the courier CN arrived ("committed before CN"): the case stays open for OPS until the CN is recorded. A release with the CN in hand closes the case for OPS. | `inExposure`, `SCOPE_SQL` |
| Courier settlement is separate from the courier CN: bank transfer (UTR) or freight-bill adjustment, over one or several CNs, part-payments allowed. | `recordSettlement` |
| Nobody decides their own request; reject / send back need a comment. | `decideApproval` |
| Every action records who did it and when. Cases with no courier CN escalate automatically after 15 days. | `log`, `runAutoEscalation` |

## Data model (Postgres, created in `src/lib/db.ts`)

| Table | What it holds |
|---|---|
| `cases` | One record per AWB: source, status, shipment details, liabilities, claim follow-up dates, and denormalised courier CN / brand CN fields for fast lists. |
| `courier_cns` | Courier credit notes, one line per AWB (claimed, amount, short-payment reason), `settled_amount` and `settlement_state`. |
| `client_cns` | Brand credit notes, one row per case (one CN number can cover several cases). |
| `settlements` | Bank (UTR) or freight-bill receipts against a courier CN. |
| `approvals` | Management approvals and escalations. At most one pending request per case. |
| `timeline_events` | Append-only audit trail per case. |
| `clients` | Client receivables (dues) for the release warning. |
| `demo_sessions` | Sandboxes in use. |

## API

All routes need a signed-in user (role checks are server-side). Main ones:
`POST /api/cases` mark a case · `POST /api/cases/disposition` Update status (one or many cases) · `POST /api/cases/release` release a brand CN · `POST /api/cases/exception` request a release without courier CN · `POST /api/cases/:id/return` and `/resubmit` · `POST /api/approvals/:id` decide · `POST /api/settlements` record a settlement · `POST /api/import` and `GET /api/import/template` bulk update · `GET /api/export` CSV · `GET /api/dashboard` · `POST /api/webhooks/courier` (header `x-webhook-secret`) lets a courier system mark cases · `GET /api/cron/escalate` (Vercel Cron).

## Before go-live

- Replace the dev sign-in with InstaLogix login.
- Uploaded documents are public (hard-to-guess) Blob links; decide whether they must be private.
- The Excel library (`xlsx` 0.18) has known security advisories; move to the current SheetJS build.
