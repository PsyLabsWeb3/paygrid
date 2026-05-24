# Testing Strategy

## Approach

Test critical paths first. Priority: contracts > backend > agent > frontend.

---

## Contracts (Foundry)

### Unit tests

```solidity
// test/PaygridLink.t.sol
contract PaygridLinkTest is Test {
    PaygridLink link;

    function setUp() public {
        link = new PaygridLink();
    }

    function test_createLink() public { ... }
    function test_createLink_withFiat() public { ... }
    function test_cancelLink_onlyCreator() public { ... }
    function test_cancelLink_revertsNotCreator() public { ... }
    function test_getLink_returnsCorrectData() public { ... }
}
```

```solidity
// test/PaygridRouter.t.sol
contract PaygridRouterTest is Test {
    PaygridRouter router;
    MockERC20 usdc;

    function setUp() public {
        usdc = new MockERC20("USDC", "USDC", 6);
        router = new PaygridRouter(address(link), treasury);
    }

    function test_pay_splitsFeeCorrectly() public { ... }
    function test_pay_emitsPaymentReceived() public { ... }
    function test_payWithFiat_emitsPaymentReceivedWithOnrampTxId() public { ... }
    function test_pay_revertsWhenLinkNotActive() public { ... }
    function test_setFeeBps_revertsAboveMax() public { ... }
}
```

### Integration tests (fork)

```solidity
// test/fork/PaygridRouter.fork.t.sol
contract PaygridRouterForkTest is Test {
    uint256 constant CELO_FORK_BLOCK = 67600000;

    function setUp() public {
        vm.createSelectFork("https://forno.celo.org", CELO_FORK_BLOCK);
    }

    function test_pay_withUSDC_onMainnet() public {
        // Impersonate a USDC holder, pay through router
        // Verify treasury + recipient balances
    }
}
```

### Run

```bash
# Unit tests
forge test

# Fork tests
forge test --fork-url https://forno.celo.org

# Gas report
forge test --gas-report
```

---

## Backend API

The backend currently uses Node's built-in test runner with `tsx`.

### Current tests

- token formatting / parsing utilities
- Privy auth middleware
- notifier hook emission

### Run

```bash
cd backend
npm test
npm run build
```

### Suggested coverage next

- `POST /api/links` happy path + validation failures
- `GET /api/links` auth filtering
- `GET /api/payments` auth filtering
- on-chain event handler idempotency
- Fonbnk config/webhook handlers once Fase 3 lands

---

## Agent

### Suggested unit tests

- wallet bootstrap
- backend API tool wrappers
- balance / history formatters
- x402 payer wrapper

### Suggested integration tests

- x402 payment flow against a test endpoint
- create link tool against backend staging
- payment status lookup against Sepolia backend

---

## E2E (Critical flows)

Manual verification on Sepolia before Mainnet:

| Flow | Steps | Check |
|------|-------|-------|
| A2A | Agent pays x402 endpoint → receives data | TX on Sepolia explorer |
| A2H | Agent creates link → human pays → agent sees confirmed | Link status in DB |
| H2A | Human pays agent's x402 endpoint → agent delivers | PaymentReceived event |
| H2H | Human creates link → another human pays | Funds arrive |
| Fiat | Human pays via Fonbnk → webhook confirms → funds settle | onramp_sessions confirmed |

---

## Test Environment

```text
Blockchain: Celo Sepolia (chainId: 11142220)
RPC: https://forno.celo-sepolia.celo-testnet.org
Faucet: https://faucet.celo.org/celo-sepolia
Tokens: use real Sepolia token addresses (same as mainnet)
Supabase: local dev or separate test project
Fonbnk: mock or sandbox API
```

---

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
```
