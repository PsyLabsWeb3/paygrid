# Architecture

## High-level overview

Paygrid has four interaction flows connected by a shared backend + contract layer:

```text
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
│  │ Links    │  │ Payments │  │ Fonbnk       │  │ x402 Endpoints    │    │
│  │ API      │  │ API      │  │ Webhooks     │  │ (future / F4)     │    │
│  └──────────┘  └──────────┘  └──────────────┘  └───────────────────┘    │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │ Event Indexer (Viem)                                             │    │
│  │ Listens to PaymentReceived events on PaygridRouter               │    │
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

```text
User opens link → connects wallet → approves token spend → confirms tx
→ PaygridRouter receives tokens → splits 0.5% to treasury → sends 99.5% to recipient
→ emits PaymentReceived event → backend indexer picks it up → updates DB → notifies recipient
```

### Fiat payment flow (Fonbnk)

```text
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
| Payments API | backend/src/routes/payments.ts | Payment status and history |
| Event Indexer | backend/src/indexer.ts | Listen to on-chain events |
| Agent Core | agent/src/agent.ts | Vercel AI SDK agent with tools |
| Agent Wallet | agent/src/wallet.ts | ERC-8004 wallet setup and management |
| x402 Handler | agent/src/x402.ts | Pay and serve x402 endpoints |
| Create Link UI | minipay/ | Payment link creation flow |
| Pay Link UI | minipay/ | Payment page with crypto/fiat tabs |
| History UI | minipay/ | Payment history |

## Deployment Shape

- **Frontend**: Vercel, directory `minipay/`
- **Backend API**: standalone `backend/` service on VPS
- **Indexer**: standalone process alongside backend on VPS or separate PM2 process
- **Agent runtime**: standalone `agent/` service on VPS
- **Database**: Supabase PostgreSQL

## Authentication

- Users: Privy JWT to backend user endpoints
- Agents: ERC-8004 identity and signed payloads in later phase
- Webhooks: API key authentication for provider callbacks

## Data Model

- Tables: `payment_links`, `payments`, `onramp_sessions`, `users`, `agents`
- See `docs/data-model.md` for full schema
