# Paygrid Backend

REST API + on-chain event indexer for payment links on Celo Sepolia.

## Setup

```bash
cd backend
cp .env.example .env
# Fill Supabase keys, Privy keys, Fonbnk keys, x402 treasury address, BACKEND_WALLET_PRIVATE_KEY, CELO_RPC_URL
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

# Treasury Quant Agent signal/TP/SL worker (separate terminal)
npm run treasury:worker
```

## Test

```bash
npm test
```

## Fase 4 endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/x402/data` | x402 proof | Example pay-per-task endpoint |

### x402 proof headers

- `x-paygrid-x402-proof` with JSON proof payload
- The backend validates `resource`, `chainId`, `token`, `amount`, `txHash`, and `payer`

## Fase 3 endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/onramp/fonbnk/config` | Public | Fonbnk carriers and indicative rates by country |
| POST | `/api/onramp/fonbnk/webhook` | `x-api-key` / `x-signature` | Fonbnk settlement webhook |

## Fase 2 endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/links` | Privy or ERC-8004 | List links for authenticated user or agent |
| GET | `/api/payments` | Privy or ERC-8004 | Payment history for authenticated user or agent |

## Fase 1 endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/links` | Create link on-chain + DB |
| GET | `/api/links/:id` | Link detail + payments |
| POST | `/api/links/:id/pay` | Crypto tx params (`method: "crypto"`) |
| POST | `/api/links/:id/pay` | Fonbnk session (`method: "fonbnk"`) |

## Treasury Quant Agent

The TradingView webhook accepts the existing signal JSON without adding fields.
Production Nginx should IP-allowlist TradingView and inject the dedicated signal
secret:

```text
POST /webhooks/tradingview/treasury
```

Signals are deduplicated by `externalSignalId` and processed asynchronously by
`npm run treasury:worker`. The worker defaults to `paper` mode. `live` mode
requires a dedicated `TREASURY_EXECUTOR_PRIVATE_KEY`. TP/SL monitoring uses an
onchain oracle as its reference price and a full-position Mento/Uniswap quote as
the executable price. Stale feeds or excessive oracle/DEX divergence pause new
entries and block automated exits.

Public read routes:

```text
GET /api/treasury/status
GET /api/treasury/signals
GET /api/treasury/positions
```

Operator routes require `X-Treasury-Admin-Key`:

```text
POST /api/treasury/control/pause
POST /api/treasury/control/resume
POST /api/treasury/positions/:id/close
```

## Contracts (Sepolia)

See [contracts/deployments.sepolia.json](../contracts/deployments.sepolia.json).
