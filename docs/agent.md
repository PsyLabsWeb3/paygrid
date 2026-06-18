# Agent Spec

The Paygrid agent is an autonomous AI agent with an ERC-8004 identity that can create payment links, inspect link/payment status, pay x402 endpoints, and generate treasury summaries. It is built with the Vercel AI SDK, viem, and thirdweb/x402.

This document is the implementation-facing spec for the agent runtime. It assumes the backend API is the standalone service in `backend/`.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Agent Runtime (VPS)                   │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────┐ │
│  │ Vercel AI SDK    │  │ x402 payer/server│  │ ERC-8004   │ │
│  │ agent + tools    │  │ thirdweb/x402    │  │ identity   │ │
│  └─────────┬────────┘  └─────────┬────────┘  └─────┬──────┘ │
│            │                     │                  │        │
│            ▼                     ▼                  ▼        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Wallet layer (viem)                                   │  │
│  │ - payment wallet for txs                              │  │
│  │ - owner wallet for identity/admin actions             │  │
│  │ - legacy txs / feeCurrency as required by Celo        │  │
│  └────────────────────────────────────────────────────────┘  │
│            │                                                  │
│            ▼                                                  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ HTTP client                                             │  │
│  │ - backend API: links, payments, status                 │  │
│  │ - x402 endpoints: pay-per-task                         │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
                ┌──────────────┐   ┌──────────────┐
                │ Backend API  │   │ Supabase     │
                └──────────────┘   └──────────────┘
```

---

## Wallet Setup

The agent has two wallet roles per ERC-8004:

| Role | Address | Purpose | Stored |
|------|---------|---------|--------|
| Owner | `0xD4683314A013792fe8840E4171dC4692E317617B` | Register agent, set metadata, authorize payment wallet | `AGENT_OWNER_PRIVATE_KEY` |
| Payment | Separate address | Pay gas + txs, create links, pay x402 endpoints | `AGENT_PRIVATE_KEY` |

### Boot flow

1. Load `AGENT_PRIVATE_KEY` and `AGENT_OWNER_PRIVATE_KEY`.
2. Create viem wallet clients.
3. Verify the agent is registered under `ERC8004_AGENT_ID`.
4. Load tools and backend URL.
5. Start serving chat / x402 / webhook routes.

---

## Tool Contract

Every tool maps to a concrete backend API call or on-chain action.

### `createPaymentLink`

Creates a stablecoin payment link for A2H / H2H flows.

```typescript
{
  name: "createPaymentLink",
  parameters: {
    amount: string,
    token: "USDC" | "USDT" | "USDm",
    description: string,
    recipientAddress: `0x${string}`,
    acceptedMethods: ("crypto" | "fonbnk")[],
  },
  returns: {
    linkId: string,
    url: string,
  }
}
```

Implementation: `POST {BACKEND_URL}/api/links` with agent auth.

### `checkPaymentStatus`

```typescript
{
  name: "checkPaymentStatus",
  parameters: { linkId: string },
  returns: {
    status: "active" | "paid" | "expired" | "cancelled",
    paidAmount?: string,
    payerAddress?: string,
    txHash?: string,
  }
}
```

Implementation: `GET {BACKEND_URL}/api/links/{id}`.

### `getBalance`

```typescript
{
  name: "getBalance",
  parameters: { token?: "USDC" | "USDT" | "USDm" },
  returns: { balances: Record<string, string> }
}
```

Implementation: viem `readContract` on ERC-20 `balanceOf`.

### `getPaymentHistory`

```typescript
{
  name: "getPaymentHistory",
  parameters: { limit?: number, status?: "active" | "paid" | "all" },
  returns: { payments: Array<Payment> }
}
```

Implementation: `GET {BACKEND_URL}/api/payments` with agent auth.

### `executeTreasuryReport`

```typescript
{
  name: "executeTreasuryReport",
  parameters: { period?: "7d" | "30d" | "all" },
  returns: {
    totalReceived: Record<string, string>,
    totalFees: Record<string, string>,
    paymentsCount: number,
    activeLinks: number,
  }
}
```

Implementation: aggregate from `GET /api/payments` + `GET /api/links`.

---

## x402 Integration

### Agent as payer

The agent uses `wrapFetchWithPayment` for protected third-party endpoints.

```typescript
import { wrapFetchWithPayment } from "thirdweb/x402";
```

### Agent as payee

The backend already exposes a pay-per-task example endpoint at `GET /api/x402/data` with x402 challenge + proof handling.
The agent runtime can consume that endpoint today.

The agent can expose its own x402 endpoint once the agent runtime is implemented. Until then, the agent-side x402 server shape remains a future task and should not be treated as production-ready.

---

## Environment Variables

```bash
AGENT_PRIVATE_KEY=0x...
AGENT_OWNER_PRIVATE_KEY=0x...
BACKEND_URL=https://api.celopaygrid.xyz
AGENT_API_KEY=sk_...
CELO_RPC_URL=https://forno.celo.org
THIRDWEB_SECRET_KEY=...
ERC8004_AGENT_ID=9113
```

---

## Lifecycle

```
STARTUP
  ├── Load env
  ├── Create viem wallet client
  ├── Verify ERC-8004 identity
  ├── Load tools
  └── Ready

RUNTIME
  ├── POST /agent/chat     — natural language to tools
  ├── POST /agent/x402     — pay-per-task endpoint
  ├── Webhook /agent/paid  — payment confirmation
  └── Cron                 — health checks / treasury reports

SHUTDOWN
  └── Graceful PM2 stop
```

---

## Files

```text
agent/
├── src/
│   ├── agent.ts
│   ├── wallet.ts
│   ├── x402-payer.ts
│   ├── x402-server.ts
│   ├── tools/
│   │   ├── create-link.ts
│   │   ├── check-status.ts
│   │   ├── get-balance.ts
│   │   ├── get-history.ts
│   │   └── treasury-report.ts
│   └── index.ts
├── .env
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Current Status

The agent spec is intentionally ahead of implementation. Current backend support exists for:

- creating payment links,
- checking link/payment state,
- generating crypto payment txs,
- indexing on-chain payment confirmations,
- authenticating agent requests with ERC-8004 signed payloads,
- serving a backend x402 challenge endpoint for pay-per-task flows,
- listing links and payments for authenticated agents.

Still pending:

- full agent runtime implementation,
- x402 server/payer code inside `agent/`,
- agent treasury report tooling.
