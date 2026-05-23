# Agent Spec

The Paygrid agent is an autonomous AI agent with an ERC-8004 identity that can create payment links, pay x402 endpoints, receive payments, and manage treasury operations. Built with Vercel AI SDK + thirdweb/x402 + @chaoschain/sdk.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Agent Runtime (VPS)               │
│                                                      │
│  ┌────────────┐  ┌────────────┐  ┌───────────────┐  │
│  │ Vercel AI  │  │ x402       │  │ ERC-8004      │  │
│  │ SDK Agent  │  │ Payer +    │  │ Identity      │  │
│  │            │  │ Server     │  │ Management    │  │
│  └─────┬──────┘  └─────┬──────┘  └───────┬───────┘  │
│        │               │                  │          │
│        ▼               ▼                  ▼          │
│  ┌──────────────────────────────────────────────┐    │
│  │              Wallet Layer (viem)              │    │
│  │  - Agent payment wallet                       │    │
│  │  - Sign transactions                          │    │
│  │  - feeCurrency: USDm / USDC adapter           │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │              HTTP Client                       │    │
│  │  - Backend API (create links, check status)    │    │
│  │  - x402 endpoints (pay, verify)                │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Backend API  │  │ Celo Chain   │  │ Supabase      │
│ (Vercel)     │  │ (RPC)        │  │               │
└──────────────┘  └──────────────┘  └──────────────┘
```

---

## Wallet Setup

The agent has two wallet roles per ERC-8004:

| Role | Address | Purpose | Stored |
|------|---------|---------|--------|
| Owner | `0xD4683314A013792fe8840E4171dC4692E317617B` | Register agent, set metadata | `AGENT_OWNER_PRIVATE_KEY` (`.env`) |
| Payment | Separate address | Pay gas + transactions | `AGENT_PRIVATE_KEY` (`.env`) |

### Payment wallet registration flow

```
1. Generate payment wallet: viem generatePrivateKey()
2. Owner signs authorization:
   setAgentWallet(agentId, paymentWallet, deadline, signature)
3. Payment wallet is now authorized to act for agent #9113
```

```typescript
// agent/src/wallet.ts
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { celo } from "viem/chains";

export function createAgentWallet(privateKey: string) {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    chain: celo,
    transport: http(),
    account,
  });
}
```

---

## Tools

Defined with Vercel AI SDK. Each tool maps to a backend API call or on-chain action.

### `createPaymentLink`

Creates a payment link for A2H or H2H flows.

```typescript
{
  name: "createPaymentLink",
  description: "Create a stablecoin payment link.",
  parameters: {
    amount: string,       // "10.00"
    token: "USDC" | "USDT" | "USDm",
    description: string,
    recipientAddress: `0x${string}`,
    acceptedMethods: ("crypto" | "fonbnk")[],
  },
  returns: {
    linkId: string,
    url: string,          // https://paygrid.xyz/pay/link_abc123
  }
}
```

Implementation: calls `POST {BACKEND_URL}/api/links` with agent auth.

### `checkPaymentStatus`

```typescript
{
  name: "checkPaymentStatus",
  description: "Check if a payment link has been paid.",
  parameters: { linkId: string },
  returns: {
    status: "active" | "paid" | "expired" | "cancelled",
    paidAmount?: string,
    payerAddress?: string,
    txHash?: string,
  }
}
```

### `getBalance`

```typescript
{
  name: "getBalance",
  description: "Get the agent's USDC, USDT, USDm, and CELO balances.",
  parameters: { token?: "USDC" | "USDT" | "USDm" },
  returns: { balances: Record<string, string> }
}
```

Reads on-chain via viem `readContract` on ERC-20 balanceOf. Token addresses: USDC `0xcebA...`, USDT `0x4806...`, USDm `0x765D...`.

### `getPaymentHistory`

```typescript
{
  name: "getPaymentHistory",
  description: "Get payment history for this agent.",
  parameters: { limit?: number, status?: "active" | "paid" | "all" },
  returns: { payments: Array<Payment> }
}
```

Calls `GET {BACKEND_URL}/api/payments` with agent auth.

### `executeTreasuryReport`

```typescript
{
  name: "executeTreasuryReport",
  description: "Generate treasury report: totals, fees, active links.",
  parameters: { period?: "7d" | "30d" | "all" },
  returns: {
    totalReceived: Record<string, string>,
    totalFees: Record<string, string>,
    paymentsCount: number,
    activeLinks: number,
  }
}
```

Aggregates from `GET /api/payments` + `GET /api/links`.

---

## x402 Integration

### A2A — Agent as Payer

```typescript
// agent/src/x402-payer.ts
import { wrapFetchWithPayment } from "thirdweb/x402";
import { privateKeyToAccount } from "thirdweb/wallets";

export function createX402Payer(privateKey: string) {
  const account = privateKeyToAccount(privateKey);
  return wrapFetchWithPayment(fetch, account);
}

// Usage: agent pays x402 endpoint automatically
const fetchWithPayment = createX402Payer(AGENT_PRIVATE_KEY);
const response = await fetchWithPayment("https://api.example.com/protected-data");
```

### H2A — Agent as Payee (x402 Server)

Agent exposes a paid endpoint:

```typescript
import { settlePayment, facilitator } from "thirdweb/x402";

export async function handleX402Request(req: Request): Promise<Response> {
  const paymentHeader = req.headers.get("payment-signature") || req.headers.get("x-payment");

  if (!paymentHeader) {
    return new Response(JSON.stringify({
      error: "Payment Required",
      scheme: "fixed",
      price: "100000",              // 0.10 USDC (6 decimals)
      currency: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      chainId: 42220,
    }), { status: 402, headers: { "Content-Type": "application/json" } });
  }

  const result = await settlePayment({
    paymentHeader,
    facilitator,
    secretKey: process.env.THIRDWEB_SECRET_KEY!,
  });

  if (!result.success) {
    return new Response(JSON.stringify({ error: "Payment failed" }), { status: 402 });
  }

  return new Response(JSON.stringify({ data: "result" }));
}
```

---

## Environment Variables

```bash
# Agent wallet
AGENT_PRIVATE_KEY=0x...          # Payment wallet (pays gas + tx)
AGENT_OWNER_PRIVATE_KEY=0x...    # Owner wallet (agent #9113)

# Backend
BACKEND_URL=https://api.paygrid.xyz
AGENT_API_KEY=sk_...

# RPC
CELO_RPC_URL=https://forno.celo.org

# x402
THIRDWEB_SECRET_KEY=...

# Identity
ERC8004_AGENT_ID=9113
```

---

## Lifecycle

```
STARTUP
  ├── Load AGENT_PRIVATE_KEY
  ├── Create viem wallet client (celo chain)
  ├── Verify authorization via getAgentWallet(#9113)
  ├── Load tools
  └── Ready

RUNTIME
  ├── POST /agent/chat     — NL → execute tools
  ├── POST /agent/x402     — pay-per-task endpoint (H2A)
  ├── Webhook: /agent/paid — payment confirmation
  └── Cron: hourly health check

SHUTDOWN
  └── Graceful PM2 stop
```

---

## Files

```
agent/
├── src/
│   ├── agent.ts          # Vercel AI SDK agent + tools
│   ├── wallet.ts         # Wallet setup (viem)
│   ├── x402-payer.ts     # Pay x402 endpoints
│   ├── x402-server.ts    # Expose paid endpoint
│   ├── tools/
│   │   ├── create-link.ts
│   │   ├── check-status.ts
│   │   ├── get-balance.ts
│   │   ├── get-history.ts
│   │   └── treasury-report.ts
│   └── index.ts          # Express/Hono server
├── .env                  # Never committed
├── .env.example
├── package.json
└── tsconfig.json
```
