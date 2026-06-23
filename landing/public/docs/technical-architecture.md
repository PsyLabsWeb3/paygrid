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
        | viem contract writes / reads
        v
PaygridLink + PaygridRouter on Celo Mainnet
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
- validating ERC-8004 signed requests;
- enforcing rate limits;
- writing normalized state into Supabase.

### Contracts

The deployed contracts are:

| Contract | Address |
|---|---|
| PaygridLink | `0x31Aa9Ba23e4CAC3f41d88fb1C904067c0b3dda89` |
| PaygridRouter | `0x2924FEf3eF7c3ADBFF22b286C42764a96c53f9f4` |

`PaygridLink` stores payment request state. `PaygridRouter` coordinates settlement and emits payment events.

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

