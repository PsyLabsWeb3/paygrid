# Architecture

## High-level overview

Paygrid has four interaction flows connected by a shared backend + contract layer:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Agent-to-    │     │ Agent-to-    │     │ Human-to-    │     │ Human-to-    │
│ Agent        │     │ Human        │     │ Agent        │     │ Human        │
├──────────────┤     ├──────────────┤     ├──────────────┤     ├──────────────┤
│ Agent pays   │     │ Agent pays   │     │ Human pays   │     │ Human pays   │
│ agent via    │     │ human via    │     │ agent via    │     │ human via    │
│ x402         │     │ link         │     │ link + fiat  │     │ link + fiat  │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │                    │
       ▼                    ▼                    ▼                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           Backend API                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐    │
│  │ Links    │  │ Payments │  │ Fonbnk        │  │ x402 Endpoints    │    │
│  │ CRUD     │  │ Service  │  │ Webhooks      │  │ (pay-per-task)    │    │
│  └──────────┘  └──────────┘  └──────────────┘  └───────────────────┘    │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                    Event Indexer (Viem)                           │    │
│  │  Listens to PaymentReceived events on PaygridRouter              │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         Celo Blockchain                                   │
│  ┌─────────────────────┐     ┌──────────────────────┐                    │
│  │ PaygridRouter.sol   │     │ PaygridLink.sol      │                    │
│  │ - fee split 0.5%    │◄────│ - link creation       │                    │
│  │ - treasury routing  │     │ - on-chain records    │                    │
│  └─────────────────────┘     └──────────────────────┘                    │
└──────────────────────────────────────────────────────────────────────────┘
```

## Payment flows

### Crypto payment flow
```
User opens link → connects wallet → approves token spend → confirms tx
→ PaygridRouter receives tokens → splits 0.5% to treasury → sends 99.5% to recipient
→ emits PaymentReceived event → backend indexer picks it up → updates DB → notifies recipient
```

### Fiat payment flow (Fonbnk)
```
User opens link → selects "Pay with mobile" → Fonbnk widget loads
→ User picks carrier → enters phone number → tops up airtime
→ Fonbnk verifies funding → converts to USDC → sends to PaygridRouter
→ POST /api/onramp/fonbnk/webhook → backend verifies on-chain tx → updates DB → notifies recipient
```

## Components

| Component | File | Responsibility |
|-----------|------|----------------|
| PaygridLink | contracts/src/PaygridLink.sol | Create and manage payment links on-chain |
| PaygridRouter | contracts/src/PaygridRouter.sol | Receive payments, split fee, forward to recipient |
| Links API | backend/src/routes/links.ts | CRUD for payment links |
| Payments API | backend/src/routes/payments.ts | Payment status, history |
| Fonbnk API | backend/src/routes/onramp/fonbnk.ts | Carrier config, webhook handler |
| Event Indexer | backend/src/indexer.ts | Listen to on-chain events |
| Agent Core | agent/src/agent.ts | Vercel AI SDK agent with tools |
| Agent Wallet | agent/src/wallet.ts | ERC-8004 wallet setup and management |
| x402 Handler | agent/src/x402.ts | Pay and serve x402 endpoints |
| Create Link UI | minipay/src/app/create/ | Payment link creation form |
| Pay Link UI | minipay/src/app/pay/[id]/ | Payment page with crypto/fiat tabs |
| History UI | minipay/src/app/history/ | Payment history |

## Database

- Supabase (PostgreSQL)
- Tables: payment_links, payments, onramp_sessions, users, agents
- See docs/data-model.md for full schema

## Authentication

- Users: Privy (social + wallet)
- Agents: ERC-8004 identity (on-chain)
- Webhooks: API key authentication (Fonbnk)
