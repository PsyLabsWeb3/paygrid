# ERC-8004 Integration

This backend uses a lightweight signed-payload gate for agent-authenticated endpoints.
It is intentionally implementation-specific: it matches the current backend middleware and can be replaced later with a fuller ERC-8004 registry flow without changing the route contracts.

## Auth headers

Agent requests must include all of the following headers:

- `x-erc8004-agent-id`
- `x-erc8004-address`
- `x-erc8004-timestamp`
- `x-erc8004-nonce`
- `x-erc8004-signature`

## Signed payload

The signed message format is:

```text
paygrid:erc8004:<agentId>:<address>:<METHOD>:<path>:<timestamp>:<nonce>
```

Rules:

- `<address>` is lowercased before signing.
- `<METHOD>` is uppercased.
- `<path>` is the exact request path, for example `/api/links`.
- `<timestamp>` is milliseconds since epoch.
- `<nonce>` is caller-generated and unique per request.

## Verification rules

The backend middleware:

- verifies the signature with `viem.verifyMessage`
- rejects missing headers with `401 UNAUTHORIZED`
- rejects timestamps older than 5 minutes with `401 UNAUTHORIZED`
- rejects invalid signatures with `401 UNAUTHORIZED`
- resolves the agent by `agent_id`
- auto-creates an `agents` row if the agent does not exist yet
- rejects if the stored agent address does not match the authenticated address

## Current usage

Agent-authenticated access currently applies to:

- `GET /api/links`
- `POST /api/links`
- `GET /api/payments`

The same auth middleware can be reused for future agent-only routes, including x402 tooling and agent runtime APIs.
