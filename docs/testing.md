# Testing Strategy

Test critical paths first. Priority: contracts > backend > agent > frontend.

## What to test

### Contracts

- `PaygridLink.createLink` emits correct `LinkCreated`
- `PaygridRouter.pay` splits fee to treasury
- `payWithFiat` only owner can call
- invalid token/amount reverts

### Backend

- link creation roundtrip: API → contract → DB
- payment indexer updates DB on `PaymentReceived`
- Privy auth middleware
- ERC-8004 auth middleware
- Fonbnk webhook verification
- x402 v2 challenge, real signature validation, upfront settlement and replay protection

### Agent

- wallet bootstrap
- backend API tool wrappers
- balance / history formatters
- x402 central executor client

### Frontend

- payment link creation flow
- payment method selection
- MiniPay deeplink handling
- receipt / status updates

## Suggested coverage next

- `POST /api/links` happy path + validation failures
- `GET /api/links` auth filtering
- `GET /api/payments` auth filtering
- on-chain event handler idempotency
- Fonbnk settlement webhook happy path with mocked chain
- ERC-8004 signed payload acceptance/rejection
- x402 payment flow against a test endpoint

## E2E (Critical flows)

Manual verification on Sepolia before Mainnet:

| Flow | Steps | Check |
|------|-------|-------|
| A2A | Agent pays x402 endpoint → receives data | TX on Sepolia explorer |
| A2H | Agent creates link → human pays → agent sees confirmed | Link status in DB |
| H2A | Human pays agent's x402 endpoint → agent delivers | PaymentReceived event |
| H2H | Human creates link → another human pays | Funds arrive |
| Fiat | Human pays via Fonbnk → webhook confirms → funds settle | onramp_sessions confirmed |

## Test Environment

```text
Blockchain: Celo Sepolia (chainId: 11142220)
RPC: https://forno.celo-sepolia.celo-testnet.org
Faucet: https://faucet.celo.org/celo-sepolia
Tokens: Sepolia USDC 0x01C5C0122039549AD1493B8220cABEdD739BC44E only; mainnet addresses differ
Supabase: local dev or separate test project
Fonbnk: mock or sandbox API
```

## CI

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: foundry-rs/foundry-toolchain@v1
      - run: cd contracts && forge test

  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: cd backend && npm ci && npm test && npm run build

  agent:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: cd agent && npm ci && npm test

## x402 validation

See [x402 validation](x402.md#validation-and-canaries). SQL tests use embedded PostgreSQL and do not access Supabase production. Fork checks exercise USDT and sponsored wMXN against real Celo contracts on Anvil; only canary evidence proves mainnet settlement.
