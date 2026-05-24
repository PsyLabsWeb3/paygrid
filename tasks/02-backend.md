# Tasks: Backend

Módulo standalone en `backend/` (Express o Hono + indexer long-running en VPS/PM2).
Specs: [docs/api.md](../docs/api.md), [docs/data-model.md](../docs/data-model.md), [docs/architecture.md](../docs/architecture.md).

**Red de desarrollo:** Celo Sepolia (chainId `11142220`). Mainnet TBD.

**Contratos Sepolia** (fuente de verdad: [contracts/deployments.sepolia.json](../contracts/deployments.sepolia.json)):

| Contract | Address |
|----------|---------|
| PaygridLink | `0xd2dc71c47803b0939944ec29ff3b644c48bae7de` |
| PaygridRouter | `0xe75027ff07931ef97248402f4df63a4d3287020d` |
| Treasury | `0xd4683314a013792fe8840e4171dc4692e317617b` |

---

## Decisiones de diseño

- **`POST /api/links` es híbrido:** llama `PaygridLink.createLink()` on-chain y persiste metadata en Supabase. Guardar el `uint256 linkId` retornado en columna `on_chain_link_id`.
- **Relayer vs client-signed:** Fase 1 usa **relayer wallet** del backend (`BACKEND_WALLET_PRIVATE_KEY`) para `createLink` con gas en Sepolia. Evaluar client-signed desde MiniPay en fase posterior.
- **Fonbnk `payWithFiat`:** solo el **owner** de `PaygridRouter` puede ejecutar la tx. El webhook Fonbnk debe verificar el pago, confirmar tokens en el router y llamar `payWithFiat` con `ROUTER_OWNER_PRIVATE_KEY`.
- **Webhook notifier (Fase 1):** log estructurado + hook interno; canal externo (email/push/webhook URL) TBD.
- **ERC-8004 auth:** spec pendiente en [docs/erc8004-integration.md](../docs/erc8004-integration.md) — stub en Fase 4 hasta completar doc.

---

## Environment variables

Crear `backend/.env` (gitignored) y `backend/.env.example` (sin secretos).

### Fase 1 — requeridas

| Variable | Descripción |
|----------|-------------|
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Writes server-side e indexer (bypass RLS) |
| `BACKEND_WALLET_PRIVATE_KEY` | Relayer: gas Sepolia para `createLink` |
| `CELO_SEPOLIA_RPC` | dRPC Celo Sepolia URL en `backend/.env` (no commitear) |
| `PAYGRID_LINK_ADDRESS` | Ver tabla arriba |
| `PAYGRID_ROUTER_ADDRESS` | Ver tabla arriba |
| `CHAIN_ID` | `11142220` (Celo Sepolia) |

### Fase 2 — Privy

| Variable | Descripción |
|----------|-------------|
| `PRIVY_APP_ID` | App ID de Privy |
| `PRIVY_APP_SECRET` | Verificación JWT server-side |

### Fase 3 — Fonbnk

| Variable | Descripción |
|----------|-------------|
| `FONBNK_API_KEY` | API Fonbnk (carriers, rates, sessions) |
| `ROUTER_OWNER_PRIVATE_KEY` | Owner de PaygridRouter Sepolia para `payWithFiat` |
| `FONBNK_WEBHOOK_SECRET` | Validar `x-api-key` en webhook (generado por nosotros o Fonbnk) |

### Fase 4 — x402 + agentes

| Variable | Descripción |
|----------|-------------|
| `THIRDWEB_SECRET_KEY` | Facilitator x402 (si el backend lo expone) |

---

## Fase 1 — Core (Sepolia + Supabase)

- [x] Initialize Node.js project in `backend/` with TypeScript + Hono (or Express)
- [x] Supabase client setup + `.env.example`
- [x] Database migrations — tables: `users`, `agents`, `payment_links`, `payments`, `onramp_sessions`
- [x] Migration: add `on_chain_link_id bigint UNIQUE` to `payment_links` (maps DB uuid ↔ on-chain `linkId`)
- [x] Error handling and input validation (Zod)
- [x] Rate limiting on public endpoints
- [x] `POST /api/links` — create link on-chain (`PaygridLink.createLink`) + persist in DB with `on_chain_link_id`
- [x] `GET /api/links/[id]` — link detail with payment methods and status
- [x] `POST /api/links/[id]/pay` — crypto path: return tx params for `PaygridRouter.pay(linkId, token, amount)`
- [x] Event indexer — Viem `watchContractEvent` on `PaygridRouter.PaymentReceived` → upsert `payments`, mark link `paid`
- [x] Webhook notifier — structured log + internal hook on payment confirmed

## Fase 2 — Auth (Privy)

- [ ] Privy auth middleware for user endpoints
- [ ] `GET /api/links` — list links for authenticated user
- [ ] `GET /api/payments` — payment history with filtering by date/token/status

## Fase 3 — Fonbnk fiat

- [ ] `GET /api/onramp/fonbnk/config` — available carriers and rates by country (via Fonbnk API, no hardcode)
- [ ] `POST /api/links/[id]/pay` — fonbnk path: return onramp session data
- [ ] API key middleware for Fonbnk webhooks (`x-api-key`)
- [ ] `POST /api/onramp/fonbnk/webhook` — verify Fonbnk payment, confirm on-chain tx, call `PaygridRouter.payWithFiat`

## Fase 4 — x402 + agentes

- [ ] x402 middleware — return 402 Payment Required for protected endpoints
- [ ] `GET /api/x402/data` — example pay-per-task endpoint
- [ ] ERC-8004 signature verification middleware for agent endpoints (blocked on [docs/erc8004-integration.md](../docs/erc8004-integration.md))
- [ ] `GET /api/links` — list links for authenticated agent

---

## Pendientes de docs (no bloquean Fase 1)

- [x] Actualizar [docs/data-model.md](../docs/data-model.md) con columna `on_chain_link_id`
- [ ] Completar [docs/erc8004-integration.md](../docs/erc8004-integration.md) (formato signed payload)
- [ ] Alinear [docs/deployment.md](../docs/deployment.md) con módulo `backend/` standalone (hoy menciona API en `minipay/`)
