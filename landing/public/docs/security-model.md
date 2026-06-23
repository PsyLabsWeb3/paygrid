# Celo PayGrid Security Model

This document describes the current Celo PayGrid security model and its limitations.

It does not claim banking compliance, SOC 2, ISO certification, insurance, guaranteed fraud protection or regulatory approval.

## Current controls

### Treasury Safe

Protocol fees are configured to route to the Celo Mainnet Safe:

```text
0xc0C019DCeCE7a3a235Ab520F394A57c132F90cD6
```

### Remote MCP write auth

Read-only MCP tools are public.

Write tools require an API key:

```text
Authorization: Bearer <PAYGRID_MCP_API_KEY>
```

This protects hosted write access to actions such as creating payment requests.

### ERC-8004 signed backend requests

The MCP signs protected backend requests with an agent key.

The backend verifies the signed request before treating it as agent-authenticated.

Message format:

```text
paygrid:erc8004:<agentId>:<address>:<METHOD>:<path>:<timestamp>:<nonce>
```

### Rate limits

Backend routes apply rate limiting to reduce abuse of public surfaces.

### CORS

The production backend allows configured frontend origins only.

### Onchain settlement

Payment status is anchored by Celo Mainnet contract events and indexed into Supabase.

### Public metadata

Agent metadata is public:

```text
https://mcp.celopaygrid.xyz/.well-known/paygrid-agent.json
```

This allows external agents and crawlers to inspect the Celo PayGrid MCP endpoint and identity.

## Current trust boundaries

| Boundary | Current protection |
|---|---|
| Public users to backend | validation, CORS, rate limits |
| External agents to MCP write tools | API key |
| MCP to backend | ERC-8004 signed headers |
| Backend to contracts | backend wallet |
| Funds settlement | Celo Mainnet contracts |
| Payment status | onchain event indexing |

## Current limitations

Celo PayGrid currently does not provide:

- per-agent scoped API keys;
- per-agent daily spend limits;
- token allowlists;
- merchant allowlists;
- max slippage controls;
- autonomous swap execution;
- advanced human approval policies;
- enterprise reconciliation controls.

These are planned hardening areas and should be represented as roadmap work, not current production capabilities.

## Planned hardening

The next security improvements are:

1. Per-agent API keys.
2. Key hashing and rotation.
3. Scopes for MCP write tools.
4. Rate limits per external agent.
5. Daily request and spend limits.
6. Token allowlists.
7. Human confirmation thresholds for higher-risk actions.
8. Audit logs for agent write operations.

