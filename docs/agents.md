# Agent Integration

Paygrid lets autonomous agents and builder runtimes use Celo stablecoin commerce through MCP, ERC-8004 signed backend requests, and payment verification tools.

## Production Endpoints

| Surface | URL |
|---|---|
| MCP | `https://mcp.celopaygrid.xyz/mcp` |
| Metadata | `https://mcp.celopaygrid.xyz/.well-known/paygrid-agent.json` |
| API | `https://api.celopaygrid.xyz` |
| Health | `https://mcp.celopaygrid.xyz/health` |

## Paygrid Agent Identity

| Item | Value |
|---|---|
| Chain | Celo mainnet |
| Chain ID | `42220` |
| ERC-8004 Agent ID | `9497` |
| Agent wallet | `0x0AcF80b591eA0fE2cf9b1108ba9E4b278f3330Ce` |
| Metadata URI | `https://mcp.celopaygrid.xyz/.well-known/paygrid-agent.json` |
| Self Protocol Agent ID | `172` |
| Self agent address | `0xEf3481bcDd48Db5FFdaF77A39F5f64BaDC957316` |

Onchain verification:

```bash
cast call 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 \
  "ownerOf(uint256)(address)" 9497 \
  --rpc-url https://forno.celo.org
```

```bash
cast call 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 \
  "tokenURI(uint256)(string)" 9497 \
  --rpc-url https://forno.celo.org
```

## MCP Connection

Agents that support remote HTTP MCP can connect directly:

```json
{
  "mcpServers": {
    "paygrid": {
      "type": "http",
      "url": "https://mcp.celopaygrid.xyz/mcp",
      "headers": {
        "Authorization": "Bearer <PAYGRID_MCP_API_KEY>"
      }
    }
  }
}
```

Read-only tools do not require a key:

```bash
curl -X POST https://mcp.celopaygrid.xyz/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Write tools require:

```text
Authorization: Bearer <PAYGRID_MCP_API_KEY>
```

For runtimes that only support local stdio MCP, use a local stdio adapter that forwards JSON-RPC calls to `https://mcp.celopaygrid.xyz/mcp`.

## Discovery Tools

Use these first when integrating a new runtime such as Hermes, OpenCLAW, or a custom agent:

| Tool | Purpose |
|---|---|
| `get_agent_capabilities` | Returns Paygrid flows, auth model, endpoints, and guardrails. |
| `get_agent_connection_guide` | Returns remote HTTP and stdio connection examples. |
| `get_celo_defi_context` | Returns Celo stablecoins and DeFi rails Paygrid can use for future agent spend. |
| `get_supported_stablecoins` | Returns configured Paygrid stablecoin addresses. |
| `get_agent_profile` | Returns the Paygrid ERC-8004 identity and MCP endpoint. |

Example:

```bash
curl -X POST https://mcp.celopaygrid.xyz/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_agent_capabilities","arguments":{}}}'
```

## Payment Flows

### Agent Creates A Request

The agent creates a payment request for a human or another agent:

```bash
curl -X POST https://mcp.celopaygrid.xyz/mcp \
  -H "content-type: application/json" \
  -H "authorization: Bearer <PAYGRID_MCP_API_KEY>" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_payment_request","arguments":{"amount":"10.00","token":"USDC","description":"Agent service payment","recipientAddress":"0x...","acceptedMethods":["crypto","card"]}}}'
```

### Agent Verifies Payment

```bash
curl -X POST https://mcp.celopaygrid.xyz/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"verify_payment","arguments":{"id":"<payment_request_id>"}}}'
```

## ERC-8004 Signed Backend Requests

When Paygrid MCP calls protected backend routes, it signs this message format with `AGENT_PRIVATE_KEY`:

```text
paygrid:erc8004:<agentId>:<address>:<METHOD>:<path>:<timestamp>:<nonce>
```

The backend validates:

- signature recovery,
- agent wallet address,
- timestamp window,
- nonce replay protection,
- existing or auto-created `agents` row.

External agents can use the same header format when they call Paygrid backend routes directly.

## Self Protocol Agent ID

Self Protocol is the sybil-resistant identity layer Paygrid will expose next to ERC-8004. ERC-8004 proves the agent exists onchain and owns a wallet; Self Protocol adds a verifiable identity signal for the human/operator behind the agent.

Current status:

- ERC-8004 mainnet registration is live for agent `9497`.
- Self Protocol Agent ID `172` is verified for the current Paygrid mainnet agent wallet.
- Self returned agent address `0xEf3481bcDd48Db5FFdaF77A39F5f64BaDC957316`.
- Self Protocol fields are supported by MCP metadata and should be exposed by the hosted MCP service.

Run the Self registration helper from `agent/`:

```bash
cd agent
node register-self-mainnet.js
```

The script returns a Self App scan URL and session token. After the Self App flow completes, update the hosted MCP env:

```bash
SELF_AGENT_ID=172
SELF_AGENT_ADDRESS=0xEf3481bcDd48Db5FFdaF77A39F5f64BaDC957316
SELF_VERIFICATION_STATUS=verified
SELF_VERIFICATION_URL=https://app.ai.self.xyz
```

Then recreate the MCP container so `https://mcp.celopaygrid.xyz/.well-known/paygrid-agent.json` reflects the verified Self status.

## Celo DeFi Roadmap For Agent Spend

Paygrid MCP currently exposes Celo DeFi context, not swap execution. The recommended next tools are:

| Tool | Status | Purpose |
|---|---|---|
| `quote_swap` | planned | Estimate conversion into the token required by a payment request. |
| `prepare_swap` | planned | Return calldata for review without execution. |
| `fund_payment_request` | planned | Swap if needed, then pay a request under policy limits. |
| `get_agent_spend_limits` | planned | Show per-agent token, slippage, and daily-volume guardrails. |
| `set_agent_spend_policy` | planned | Admin-only policy configuration for autonomous spend. |

Celo rails to prioritize:

- Uniswap V3/V4 for general token routing.
- Mento stablecoins for local-currency stablecoin routes.
- Aave V3/Morpho for future agent treasury and liquidity context.

## Security Model

Current:

- MCP remote write tools require API key.
- Backend write routes use ERC-8004 signed headers.
- Backend routes are rate-limited.
- Treasury is a Safe.

Planned:

- Per-agent API keys.
- Scoped permissions.
- Daily spend limits.
- Token allowlists.
- Merchant/request allowlists.
- Max slippage and max transaction size.
