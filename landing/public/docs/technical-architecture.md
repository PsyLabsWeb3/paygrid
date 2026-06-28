# Celo PayGrid Technical Architecture

Celo PayGrid connects AI agents, payment requests, Celo Mainnet settlement and verification through a remote MCP service and backend API.

## System diagram

```text
AI Agent / Builder Runtime
        |
        | MCP JSON-RPC
        v
Celo PayGrid MCP HTTP
        |
        | ERC-8004 signed backend request
        v
Celo PayGrid Backend API
        |
        | viem contract writes / reads + swap quote building
        v
PaygridLink + PaygridRouterV2 on Celo Mainnet
        |
        | optional payWithSwap
        v
Mento Router
        |
        | PaymentReceived event
        v
Indexer
        |
        | normalized payment state
        v
Supabase
        |
        | payment lookup / verification
        v
MCP verify_payment + Frontend checkout status
```

## Components

### MCP HTTP service

The MCP service exposes tools for agents and builders.

Production endpoint:

```text
https://mcp.celopaygrid.xyz/mcp
```

The MCP service is responsible for:

- exposing tools through JSON-RPC;
- serving public agent metadata;
- protecting write tools with an API key;
- signing protected backend requests with the configured agent key;
- returning agent-readable payment responses.

### Backend API

Production endpoint:

```text
https://api.celopaygrid.xyz
```

The backend is responsible for:

- creating payment requests;
- reading payment request state;
- preparing transaction payloads;
- quoting Mento-first stablecoin swaps across USDC, USDT and USDm;
- preparing approval and `payWithSwap` transaction payloads;
- validating ERC-8004 signed requests;
- enforcing rate limits;
- writing normalized state into Supabase.

### Contracts

The deployed contracts are:

| Contract | Address |
|---|---|
| PaygridLink | `0x31Aa9Ba23e4CAC3f41d88fb1C904067c0b3dda89` |
| PaygridRouterV2 | `0x8d290c97100f0e87e04Efd1a790F27004fA3f08B` |
| Mento Router | `0x4861840C2EfB2b98312B0aE34d86fD73E8f9B6f6` |

`PaygridLink` stores payment request state. `PaygridRouterV2` coordinates exact-token settlement, swap-enabled settlement and payment events.

### Swap settlement path

For exact-token payments, the payer approves the settlement token and calls `pay`.

For cross-token payments, the backend creates a quote and returns:

- an approval transaction for the payer token;
- a `payWithSwap` transaction targeting `PaygridRouterV2`;
- the swap target and calldata for the authorized router.

`PaygridRouterV2` pulls the input token, approves the authorized swap target, executes the swap, validates that it received at least the requested settlement amount, refunds any excess output, splits the Paygrid fee in the settlement token, pays the recipient and marks the link paid.

Mento is the primary route for supported stablecoin swaps. Uniswap can be configured as a fallback by environment variable.

### Indexer

The indexer watches `PaymentReceived` events from the router and updates Supabase with confirmed payment records.

The indexer is private infrastructure and has no public port.

### Supabase

Supabase stores normalized application state:

- agents;
- payment links;
- payments;
- onramp sessions;
- users;
- migration state.

Service-role credentials are used only by backend services.

### Frontend

The Celo PayGrid checkout is used to display payment requests and guide payment submission.

The frontend reads from the backend and submits transactions through the connected wallet environment.

## Trust boundaries

| Boundary | Control |
|---|---|
| Browser to backend | CORS, backend validation, rate limits |
| MCP remote write tools | API key |
| MCP to backend protected routes | ERC-8004 signed HTTP headers |
| Backend to contracts | backend wallet / viem |
| Contract settlement | Celo Mainnet |
| Swap execution | Authorized Mento / Uniswap router targets |
| Payment status | indexer + Supabase + onchain events |

## ERC-8004 signed request format

Protected backend requests can be authenticated with signed headers.

Message format:

```text
paygrid:erc8004:<agentId>:<address>:<METHOD>:<path>:<timestamp>:<nonce>
```

The backend verifies:

- signature recovery;
- claimed address;
- timestamp window;
- nonce replay protection;
- agent identity row.

## Deployment shape

| Surface | Runtime |
|---|---|
| `https://celopaygrid.xyz` | landing / frontend hosting |
| `https://api.celopaygrid.xyz` | VPS + Nginx + Docker backend |
| `https://mcp.celopaygrid.xyz` | VPS + Nginx + Docker MCP HTTP |
| indexer | private Docker service |
| database | Supabase |
| contracts | Celo Mainnet |
