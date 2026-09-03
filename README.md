# Resin Ops — Backend

REST API for the Resin Ops production planning platform (Thermax ion exchange resin manufacturing, Phase 1). Next.js App Router, Route Handlers only — no UI. Owns the Neon Postgres connection via Drizzle ORM.

Frontend dashboard lives in a separate repo: [Autonex009/Resin-ops](https://github.com/Autonex009/Resin-ops).

## Getting Started

```bash
npm install
npm run dev   # http://localhost:3002
```

Requires a `.env.local` with:

- `DATABASE_URL` — Neon Postgres connection string
- `INTERNAL_API_KEY` — shared secret; every request must send it as the `x-internal-api-key` header. Must match the value configured on the frontend.

## Database

Schema lives in `src/db/schema.ts`.

```bash
npm run db:push    # push schema changes to Neon
npm run db:studio  # open Drizzle Studio
npm run db:seed    # seed initial plant data
```

## Endpoints

- `GET /api/kpis` — overview KPIs (plan attainment, capacity utilization, batches behind)
- `GET /api/plants` — list plants
- `GET /api/plan-vs-actual?plant=&stream=&month=` — day-by-day planned vs actual
- `GET /api/capacity?month=` — capacity utilization by plant/stream
- `GET /api/batches` — batch schedule
- `GET /api/commitments` — sales commitments
- `POST /api/import/sales-commitments` — multipart file upload
- `POST /api/import/plant-capacity` — multipart file upload
- `POST /api/import/daily-output` — multipart file upload

All endpoints (except the root health check) require the `x-internal-api-key` header.
