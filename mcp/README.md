# Paygrid MCP

Paygrid MCP exposes Paygrid as agent spend infrastructure for builders and agents on Celo.

## Local stdio

```bash
cd mcp
npm install
npm run start:stdio
```

Write tools require:

```bash
BACKEND_URL=http://localhost:3001
AGENT_PRIVATE_KEY=0x...
ERC8004_AGENT_ID=...
CHAIN_ID=11142220
```

## Remote HTTP

```bash
cd mcp
npm install
PAYGRID_MCP_API_KEY=sk_... npm run start:http
```

Remote write tools require `Authorization: Bearer <PAYGRID_MCP_API_KEY>` or `X-API-Key`.

Read-only tools can be called without a key.

## Public metadata

Hosted deployments expose:

```text
GET /health
GET /metadata
GET /.well-known/paygrid-agent.json
POST /mcp
```

## Self Protocol Agent ID

The MCP metadata supports optional Self Protocol fields:

```bash
SELF_AGENT_ID=
SELF_AGENT_ADDRESS=
SELF_VERIFICATION_STATUS=pending
SELF_VERIFICATION_URL=
```

Set `SELF_VERIFICATION_STATUS=verified` only after the Self App verification flow is completed for the current Paygrid mainnet agent wallet. When verified, the public metadata and `get_agent_capabilities` include `self-agent-id` in `supportedTrust`.
