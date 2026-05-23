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

## Backend API (Vitest + Supertest)

```typescript
// backend/src/__tests__/links.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../app";

const app = createApp();

describe("POST /api/links", () => {
  it("creates a crypto-only link", async () => {
    const res = await request(app)
      .post("/api/links")
      .send({
        amount: "10.00",
        token: "USDC",
        description: "Test link",
        acceptedMethods: ["crypto"],
        recipientAddress: "0x...",
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe("active");
  });

  it("creates a link accepting fiat", async () => { ... });
  it("rejects invalid token", async () => { ... });
  it("rejects negative amount", async () => { ... });
});

describe("POST /api/links/[id]/pay", () => {
  it("returns crypto tx params for crypto method", async () => { ... });
  it("returns Fonbnk session for fonbnk method", async () => { ... });
  it("rejects unsupported method for link", async () => { ... });
});

describe("GET /api/onramp/fonbnk/config", () => {
  it("returns carriers for valid country", async () => { ... });
  it("returns 404 for unsupported country", async () => { ... });
});

describe("POST /api/onramp/fonbnk/webhook", () => {
  it("confirms payment and updates status", async () => { ... });
  it("rejects invalid API key", async () => { ... });
});
```

### Mock strategy

- Supabase: mock client or use Supabase local dev
- Fonbnk API: wiremock or nock
- Celo RPC: mock viem publicClient

---

## Agent (Unit + Integration)

### Tool unit tests

```typescript
// agent/src/tools/__tests__/create-link.test.ts
import { describe, it, expect, vi } from "vitest";

describe("createPaymentLink tool", () => {
  it("calls backend API with correct params", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => ({ id: "link_123", url: "https://..." }),
    });

    const result = await createPaymentLink.handle({
      amount: "10.00",
      token: "USDC",
      description: "Test",
      recipientAddress: "0x...",
      acceptedMethods: ["crypto"],
    }, { fetch: mockFetch });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/links"),
      expect.objectContaining({ method: "POST" })
    );
  });
});
```

### x402 integration test

```typescript
// agent/src/__tests__/x402.integration.test.ts
describe("x402 payer", () => {
  it("pays a test endpoint on Sepolia", async () => {
    const payer = createX402Payer(TEST_PRIVATE_KEY);
    const response = await payer("https://test-x402.example.com/data");
    expect(response.status).toBe(200);
  });
});
```

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

```
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
      - run: cd backend && npm ci && npm test

  agent:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: cd agent && npm ci && npm test
```
