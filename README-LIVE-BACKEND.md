# Live backend wiring (dev copy)

This copy talks to the Smart-Finance FastAPI backend (`/dispute-operations/*`) instead of the old Next.js API routes and Postgres demo data.

## Run

```powershell
npm install
npm run build      # verify
npm run dev        # http://localhost:3000  (or: npm run start after build)
```

Base URL: defaults to `https://smart-financeapi-dev.shipdelight.com`; override with `NEXT_PUBLIC_API_BASE_URL` at build time, or edit it on the sign-in screen (`/`), stored in localStorage.

Sign-in: on `/`, paste a bearer token per role (OPS, ACCOUNTS, MANAGEMENT, KAM) and click "Continue as …". Tokens live only in this browser's localStorage (`ld_api_token_<ROLE>`). Switch role from the bottom-right widget.

## Deploy on Vercel

1. Push this repo to GitHub/GitLab/Bitbucket and import it in Vercel (Framework Preset: Next.js).
2. Set env var `NEXT_PUBLIC_API_BASE_URL` = `https://smart-financeapi-dev.shipdelight.com` (Production + Preview).
3. Deploy. No Neon, Blob, or Cron needed — this copy is a static-ish Next frontend that calls the FastAPI backend from the browser.

## CORS note

The browser calls the backend directly, so the backend must allow the frontend origin (`http://localhost:3000` locally, and your `*.vercel.app` / custom domain in production) with the `Authorization` and `Content-Type` headers and GET/POST methods. If requests fail with "Cannot reach … (CORS)", add the origin to the backend's CORS allow-list.

## Code map

- `src/lib/api.ts` – API client (envelope unwrap, bearer token, every endpoint)
- `src/components/ApiKit.tsx`, `LiveActions.tsx`, `LiveCaseList.tsx`, `LiveBulk.tsx`, `ApiLogin.tsx`, `LiveTopNav.tsx`
- Not wired yet: import template / import (coming soon), client dues and KAM name (hidden).
