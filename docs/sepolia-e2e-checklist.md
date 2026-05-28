# Sepolia E2E Checklist

Use this checklist before any Celo Mainnet deployment. The goal is to prove that the contracts, backend, indexer, agent, database, and settlement flows work together on Celo Sepolia with real transaction hashes.

## Current Sepolia Deployment

Source of truth: `contracts/deployments.sepolia.json`.

| Contract | Address | Deploy tx |
|----------|---------|-----------|
| PaygridLink | `0x58b7125e0bed4d082985c76b772bf84808e5a474` | `0x5cdd12d7f398937c7a2915088dd58147106c6428457d29b4ebfd9ae06d0a947d` |
| PaygridRouter | `0xb3fe724934de14afd56157bacb8ed6907a3d091b` | `0x97621473662b2c2a9a19bb50e2c75ac354789ee96d52502aeed0aa7903bb25e1` |

## Preflight

- [ ] Contracts tests pass.
- [ ] Backend build passes.
- [ ] Backend tests pass.
- [ ] Agent tests pass.
- [ ] Backend ABIs are regenerated from Foundry artifacts and include `PaygridRouter.payWithFiat`.
- [ ] Backend `.env` points to Celo Sepolia.
- [ ] Supabase test project has the latest migration applied.
- [ ] Backend relayer wallet has Sepolia gas funds.
- [ ] Router owner wallet is available for `payWithFiat` tests.
- [ ] Test payer wallet has the selected stablecoin on Sepolia.
- [ ] Indexer can connect to the same RPC and router address as the backend.

Recommended local checks:

```bash
cd contracts
forge test

cd ../backend
npm run build
npm test

cd ../agent
npm test
```

## Environment Snapshot

Fill this before running E2E.

| Field | Value |
|-------|-------|
| Date | |
| Tester | |
| Git branch | |
| Git commit | |
| RPC URL label | |
| Chain ID | `11142220` |
| PaygridLink | |
| PaygridRouter | |
| Treasury | |
| Backend URL | |
| Supabase project | |
| Agent ID | |
| Agent payment wallet | |
| Backend relayer wallet | |

## Evidence Log

Record every real transaction or externally visible result.

| Step | Status | Tx hash / ID | Explorer / URL | Notes |
|------|--------|--------------|----------------|-------|
| Deploy PaygridLink | Done | `0x5cdd12d7f398937c7a2915088dd58147106c6428457d29b4ebfd9ae06d0a947d` | | Existing deploy |
| Deploy PaygridRouter | Done | `0x97621473662b2c2a9a19bb50e2c75ac354789ee96d52502aeed0aa7903bb25e1` | | Existing deploy |
| Create payment link via API | | | | |
| Build crypto payment tx via API | | | | |
| Pay link with stablecoin | | | | |
| Indexer processes `PaymentReceived` | | | | |
| DB marks link as `paid` | | DB row ID: | | |
| Agent lists owned links | | | | |
| Agent lists payment history | | | | |
| Agent pays x402 endpoint | | | | |
| x402 proof verified by backend | | | | |
| Fonbnk config fetch | | | | |
| Fonbnk sandbox webhook | | Provider/session ID: | | |
| `payWithFiat` settlement | | | | |

## Flow 1: Backend Health

Acceptance criteria:

- [ ] `GET /health` returns `ok: true`.
- [ ] Returned `chainId` is `11142220`.

Record:

| Request | Response summary |
|---------|------------------|
| `GET /health` | |

## Flow 2: Create Payment Link

Purpose: prove `POST /api/links` calls `PaygridLink.createLink`, reads `LinkCreated`, and persists the DB row.

Steps:

- [ ] Start backend with Sepolia env.
- [ ] Authenticate as a Privy user or ERC-8004 agent.
- [ ] Call `POST /api/links` with a small amount and supported token.
- [ ] Confirm response includes `id`, `onChainLinkId`, `txHash`, `status: active`.
- [ ] Confirm `payment_links.on_chain_link_id` exists in Supabase.
- [ ] Confirm transaction exists on Sepolia explorer.

Record:

| Field | Value |
|-------|-------|
| DB link ID | |
| On-chain link ID | |
| Create tx hash | |
| Token | |
| Amount | |
| Recipient | |

## Flow 3: Crypto Payment

Purpose: prove `POST /api/links/:id/pay` returns a valid router call and `PaygridRouter.pay` settles correctly.

Steps:

- [ ] Call `POST /api/links/:id/pay` with `{ "method": "crypto" }`.
- [ ] Confirm tx target is `PAYGRID_ROUTER_ADDRESS`.
- [ ] Approve token allowance for `PaygridRouter`.
- [ ] Submit the `pay` transaction from the payer wallet.
- [ ] Confirm `PaymentReceived` was emitted.
- [ ] Confirm treasury received the 0.5% fee.
- [ ] Confirm recipient received 99.5%.

Record:

| Field | Value |
|-------|-------|
| Allowance tx hash | |
| Pay tx hash | |
| Fee amount | |
| Net amount | |
| Payer | |
| Recipient | |
| Treasury | |

## Flow 4: Indexer And DB Confirmation

Purpose: prove the long-running indexer handles `PaymentReceived` and updates Supabase.

Steps:

- [ ] Start indexer with the same Sepolia env.
- [ ] Ensure it logs the watched router address.
- [ ] Run or replay a crypto payment.
- [ ] Confirm `payments` has one confirmed row for the tx hash.
- [ ] Confirm `payment_links.status` is `paid`.
- [ ] Confirm duplicate event handling is idempotent.

Record:

| Field | Value |
|-------|-------|
| Indexer process / command | |
| Payment row ID | |
| Link status after index | |
| Duplicate handling result | |

## Flow 5: Agent Backend Tools

Purpose: prove the ERC-8004 agent can use backend APIs with signed headers.

Steps:

- [ ] Set `AGENT_PRIVATE_KEY`, `ERC8004_AGENT_ID`, `BACKEND_URL`, `CHAIN_ID=11142220`.
- [ ] Run an agent prompt to create a payment link.
- [ ] Run an agent prompt to check the link status.
- [ ] Run an agent prompt to list payment history.
- [ ] Run an agent prompt to generate a treasury report.

Record:

| Tool | Status | Output summary |
|------|--------|----------------|
| createPaymentLink | | |
| checkPaymentStatus | | |
| getPaymentHistory | | |
| executeTreasuryReport | | |

## Flow 6: x402 Agent-To-Agent

Purpose: prove a Paygrid agent can access a protected endpoint after payment.

Current minimum acceptance:

- [ ] Backend returns a `402 PAYMENT_REQUIRED` challenge.
- [ ] Agent builds a proof and retries.
- [ ] Backend accepts the proof.
- [ ] Protected response is returned.

Mainnet-readiness acceptance:

- [ ] The proof `txHash` is verified on-chain.
- [ ] Backend confirms token, amount, recipient, chain ID, and tx uniqueness.
- [ ] x402 payment is persisted in Supabase or an audit log.

Record:

| Field | Value |
|-------|-------|
| Protected endpoint | |
| Challenge amount | |
| Challenge token | |
| Payment tx hash | |
| Proof accepted? | |
| On-chain verification implemented? | |

## Flow 7: Fonbnk / Fiat Settlement

Purpose: prove fiat/onramp settlement can complete without corrupting link/payment state.

Minimum sandbox acceptance:

- [ ] `GET /api/onramp/fonbnk/config?country=<ISO>` returns supported carriers/channels.
- [ ] `POST /api/links/:id/pay` with `method: fonbnk` creates an `onramp_sessions` row.
- [ ] Webhook authentication accepts valid `x-api-key` or `x-signature`.
- [ ] Webhook rejects invalid auth.

Mainnet-readiness acceptance:

- [ ] Fonbnk settlement tx transfers the exact stablecoin amount to `PaygridRouter`.
- [ ] Backend verifies the transfer log.
- [ ] Backend calls `PaygridRouter.payWithFiat`.
- [ ] Link becomes `paid`.
- [ ] Payment row is confirmed and idempotent.

Record:

| Field | Value |
|-------|-------|
| Country | |
| Payment channel | |
| Carrier | |
| Onramp session ID | |
| Fonbnk order ID | |
| Settlement transfer tx | |
| `payWithFiat` tx | |
| Final link status | |

## Flow 8: Failure Cases

Run at least these before mainnet:

- [ ] Paying an already paid link reverts or returns `ALREADY_PAID`.
- [ ] Paying an expired link reverts or returns `EXPIRED`.
- [ ] Wrong token is rejected.
- [ ] Wrong amount is rejected.
- [ ] Missing auth on owned routes returns `UNAUTHORIZED`.
- [ ] Invalid ERC-8004 signature returns `UNAUTHORIZED`.
- [ ] Invalid Fonbnk webhook signature returns `UNAUTHORIZED`.
- [ ] Duplicate payment event does not create duplicate rows.

## Mainnet Go / No-Go

Do not deploy to mainnet until all required items are checked.

Required:

- [ ] Contracts tests pass locally.
- [ ] Backend build and tests pass.
- [ ] Agent tests pass.
- [ ] Sepolia create-link flow has a real tx hash.
- [ ] Sepolia crypto payment flow has a real tx hash.
- [ ] Indexer confirmed at least one payment in DB.
- [ ] ABIs are synced with current contracts.
- [ ] Mainnet deployment scripts do not hardcode Sepolia.
- [ ] Treasury address is final.
- [ ] Owner and relayer wallet security is reviewed.
- [ ] `.env` files and private keys are not committed.
- [ ] Known limitations are documented.

Optional but recommended:

- [ ] x402 verifies payment on-chain.
- [ ] Fonbnk sandbox settlement completes.
- [ ] Contracts are verified on Celoscan Sepolia.
- [ ] A short demo recording exists.
- [ ] Grant evidence table is complete.

## Known Gaps To Track

| Gap | Owner | Target date | Status |
|-----|-------|-------------|--------|
| x402 proof does not yet verify payment on-chain | | | |
| MiniPay frontend is not implemented | | | |
| Fonbnk needs sandbox/full settlement validation | | | |
| Mainnet deployment scripts need separate config | | | |
