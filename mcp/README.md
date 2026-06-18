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
