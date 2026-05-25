# Paygrid Backend

REST API + on-chain event indexer for payment links on Celo Sepolia.

## Setup

```bash
cd backend
cp .env.example .env
# Fill Supabase keys, Privy keys, Fonbnk keys, BACKEND_WALLET_PRIVATE_KEY, CELO_SEPOLIA_RPC
npm install
```

## Database migration

Option A — SQL Editor (no `DATABASE_URL` needed):

1. Open Supabase Dashboard → SQL → New query
2. Paste [supabase/migrations/20260523000001_initial_schema.sql](./supabase/migrations/20260523000001_initial_schema.sql)
3. Run

Option B — CLI script:

```bash
# Add DATABASE_URL from Supabase → Database → Connection string (URI)
npm run db:migrate
```

## Run

```bash
# API server (default :3001)
npm run dev

# Event indexer (separate terminal)
npm run indexer
```

## Test

```bash
npm test
```

## Fase 3 endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/onramp/fonbnk/config` | Public | Fonbnk carriers and indicative rates by country |
| POST | `/api/onramp/fonbnk/webhook` | `x-api-key` / `x-signature` | Fonbnk settlement webhook |

## Fase 2 endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/links` | Privy | List links for authenticated user |
| GET | `/api/payments` | Privy | Payment history for authenticated user |

## Fase 1 endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/links` | Create link on-chain + DB |
| GET | `/api/links/:id` | Link detail + payments |
| POST | `/api/links/:id/pay` | Crypto tx params (`method: "crypto"`) |
| POST | `/api/links/:id/pay` | Fonbnk session (`method: "fonbnk"`) |

## Contracts (Sepolia)

See [contracts/deployments.sepolia.json](../contracts/deployments.sepolia.json).
