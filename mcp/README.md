# Paygrid MCP

Paygrid exposes its existing payment, gift and treasury tools through the official MCP SDK.
Both local stdio and stateless Streamable HTTP are supported.

```sh
npm ci
npm run start:stdio
# or
npm run start:http
```

Local ordinary write tools use AGENT_PRIVATE_KEY and ERC8004_AGENT_ID for existing backend authentication.
Remote write tools require Authorization: Bearer PAYGRID_MCP_API_KEY or X-API-Key.
Treasury administration also requires TREASURY_ADMIN_API_KEY in the server environment.
Read-only discovery remains public.

## x402 APIs

- get_x402_capabilities: live backend readiness, currencies and prices.
- pay_x402_endpoint: central executor payment; requires url and a stable idempotencyKey.
- get_x402_payment_status: inspect an existing operationId without authorizing another payment.

The MCP server needs X402_EXECUTOR_API_KEY, not the payer private key or facilitator key.
The operator setup command creates an ignored .env.x402 client file for local use.
Payment headers and signing/policy overrides are forbidden. Pending/unknown operations must reuse their original key or be queried.
x402 payment support is advertised only when backend capability checks succeed.

```json
{
  "name": "pay_x402_endpoint",
  "arguments": {
    "url": "https://api.celopaygrid.xyz/api/x402/data",
    "preferredToken": "wMXN",
    "idempotencyKey": "a-stable-operation-0001"
  }
}
```

Use an official MCP client, initialize the connection, then list/call tools.
HTTP clients must accept application/json and text/event-stream and carry the negotiated MCP-Protocol-Version.
Endpoint: https://mcp.celopaygrid.xyz/mcp.
GET /health and the /metadata, /.well-known/agent.json and /.well-known/paygrid-agent.json cards remain available.
Keep SELF_VERIFICATION_STATUS pending until the current wallet completes Self verification.

See ../docs/x402.md for prices, limits, setup, migration, canaries and recovery.
