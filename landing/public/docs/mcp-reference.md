# Celo PayGrid MCP Reference

Celo PayGrid exposes a remote MCP endpoint for AI agents and builder runtimes.

```text
https://mcp.celopaygrid.xyz/mcp
```

## List tools

```bash
curl -X POST https://mcp.celopaygrid.xyz/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Authentication

Read-only tools are public.

Remote write tools require:

```text
Authorization: Bearer <PAYGRID_MCP_API_KEY>
```

or:

```text
X-API-Key: <PAYGRID_MCP_API_KEY>
```

## Current tools

| Tool | Auth | Purpose |
|---|---|---|
| `create_payment_request` | API key | Create an agent-owned payment request on Celo. |
| `get_payment_request` | public | Fetch a payment request and its state. |
| `verify_payment` | public | Verify whether a payment request is paid. |
| `list_agent_requests` | API key | List requests owned by the configured ERC-8004 agent. |
| `create_card_checkout` | API key | Create a card-funded checkout session for an existing request. |
| `pay_x402_endpoint` | API key | Call an x402-protected endpoint with caller-provided payment headers. |
| `get_supported_stablecoins` | public | List supported Celo stablecoins and configured addresses. |
| `get_agent_capabilities` | public | Return endpoints, auth model, current flows and guardrails. |
| `get_agent_connection_guide` | public | Return MCP connection examples for remote HTTP and local stdio adapters. |
| `get_celo_defi_context` | public | Return Celo DeFi context for future agent spend features. |
| `get_agent_profile` | public | Return Celo PayGrid ERC-8004 profile. |
| `treasury_report` | API key | Return payment volume data from backend routes. |

## Discover capabilities

```bash
curl -X POST https://mcp.celopaygrid.xyz/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_agent_capabilities","arguments":{}}}'
```

## Get supported stablecoins

```bash
curl -X POST https://mcp.celopaygrid.xyz/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_supported_stablecoins","arguments":{}}}'
```

Expected chain:

```json
{
  "chainId": 42220
}
```

## Create a payment request

```bash
curl -X POST https://mcp.celopaygrid.xyz/mcp \
  -H "content-type: application/json" \
  -H "authorization: Bearer <PAYGRID_MCP_API_KEY>" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"create_payment_request","arguments":{"amount":"10.00","token":"USDC","description":"Agent service payment","recipientAddress":"0x...","acceptedMethods":["crypto","card"]}}}'
```

Response fields include:

- `id`;
- `onChainLinkId`;
- `url`;
- `amount`;
- `token`;
- `status`;
- `createdAt`;
- `txHash`.

## Verify payment

```bash
curl -X POST https://mcp.celopaygrid.xyz/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"verify_payment","arguments":{"id":"<payment_request_id>"}}}'
```

Response fields include:

- payment request ID;
- onchain link ID;
- status;
- paid boolean;
- transaction hash;
- payment rows.

## Connection guide

```bash
curl -X POST https://mcp.celopaygrid.xyz/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"get_agent_connection_guide","arguments":{"runtime":"generic"}}}'
```

Use the returned config as the starting point for remote MCP-capable agent runtimes.

