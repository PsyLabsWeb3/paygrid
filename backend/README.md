# Paygrid Backend

REST API + on-chain event indexer for payment links on Celo. The Odeleite
partner integration is Mainnet-only and remains disabled by default.

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

## Odeleite partner links

Private endpoints, protected with the dedicated bearer in
`ODELEITE_PARTNER_API_KEY`:

| Method | Path | Description |
|---|---|---|
| POST | `/api/partners/v1/payment-links` | Persist intent, sign, persist raw transaction, broadcast and activate |
| GET | `/api/partners/v1/payment-links/:externalId` | Reconciliation state and exact confirmed payment |
| POST | `/api/partners/v1/payment-links/:externalId/cancel` | Idempotent on-chain cancellation |

POST requests require a UUID `Idempotency-Key`. A unique database constraint
and request fingerprint return the same link for an identical retry and reject
different data with `409`. The Odeleite relayer is exclusive and serialized;
its signed transaction and hash are stored before broadcast so a process restart
can resume without creating a second link.

Migration `20260924000015_odeleite_partner_links.sql` creates the exact atomic
columns and persistent webhook outbox. Database triggers enqueue link state and
payment events in the same transaction as their source row. The indexer retries
signed HMAC webhooks and remains the authority for `paid`.

Production sequence:

1. Keep `ODELEITE_PARTNER_ENABLED=false` and apply all migrations.
2. Use a dedicated minimally funded `ODELEITE_RELAYER_PRIVATE_KEY`.
3. During the internal pilot, run one API process for that relayer because its
   nonce serializer is process-local.
4. Run `npm run odeleite:preflight` against Celo Mainnet.
5. Do not enable unless it reports a `feeBps` within the router's
   `MAX_FEE_BPS` and validates both fixed contract addresses, tokens, routes,
   fee currencies and the relayer.
6. Enable the partner API and keep API plus indexer running.

Odeleite does not impose a second fee target. The current router value is
returned with every prepared payment, captured again at the payment block by
the indexer, and included in the signed webhook so Odeleite can validate the
exact gross, fee and net amounts.

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
the executable price. Unsafe quotes are isolated to their signal or position;
they do not pause unrelated markets.

Round-robin entries are controlled by
`TREASURY_MAX_OPEN_POSITIONS_PER_ASSET`. Each accepted signal creates an
independent position with its own TP/SL and realizable PnL, while the aggregate
remains bounded by `TREASURY_MAX_TOTAL_EXPOSURE_USD`.

Supported live markets are CELO, XAUt0, ETH, BTC and EURm. TradingView aliases
are normalized to the onchain assets: `XAUTUSDT` -> `XAUT0`, `ETHUSDT` ->
`WETH`, `BTCUSDT` -> `WBTC`, and `EURUSDT`/`CEURUSDT` -> `EURM`. New markets
are opt-in through `TREASURY_WETH_ENABLED`, `TREASURY_WBTC_ENABLED` and
`TREASURY_EURM_ENABLED`. WETH and WBTC use direct Uniswap V3 routing; EURm is
Mento-first with Uniswap fallback.

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
POST /api/treasury/control/close-all
POST /api/treasury/positions/:id/close
```

## Contracts (Sepolia)

See [contracts/deployments.sepolia.json](../contracts/deployments.sepolia.json).
