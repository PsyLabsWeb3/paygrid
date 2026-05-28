# API Spec

Base URL: `https://api.paygrid.xyz` (TBD)

## Authentication

- User endpoints: Privy JWT in `Authorization: Bearer <token>`
- Agent endpoints: ERC-8004 signed payload headers
- Webhook endpoints: API key in `x-api-key` header
- x402 protected endpoints: `x-paygrid-x402-proof` header with JSON proof payload

---

## Payment Links

### `POST /api/links`

Create a new payment link.

Auth: Privy user or ERC-8004 agent.

```json
{
  "amount": "10.00",
  "token": "USDC",
  "description": "Freelance design work",
  "acceptedMethods": ["crypto", "fonbnk"],
  "recipientAddress": "0x..."
}
```

Response:
```json
{
  "id": "link_abc123",
  "url": "https://paygrid.xyz/pay/link_abc123",
  "amount": "10.00",
  "token": "USDC",
  "status": "active",
  "createdAt": "2026-05-23T10:00:00Z"
}
```

### `GET /api/links/[id]`

Get link details. Returns accepted methods, status, and payment history.

### `GET /api/links`

List links for the authenticated user or agent.

Auth: Privy user or ERC-8004 agent.

Query params: `?cursor=<iso-timestamp>&limit=20&status=active&token=USDC`

---

## Payments

### `POST /api/links/[id]/pay`

Initiate a payment. For crypto, returns transaction params. For Fonbnk, returns session data.

```json
{
  "method": "crypto"
}
```

Crypto response:
```json
{
  "method": "crypto",
  "tx": {
    "to": "0x...",
    "data": "0x...",
    "value": "0"
  }
}
```

Fonbnk response:
```json
{
  "method": "fonbnk",
  "session": {
    "id": "onramp_xyz",
    "provider": "fonbnk",
    "redirectUrl": "https://fonbnk.com/pay/...",
    "orderId": "fonbnk_order_123",
    "countryIsoCode": "KE",
    "paymentChannel": "mobile_money",
    "carrierCode": "safaricom"
  }
}
```

Onramp sessions are stored with a provider-agnostic shape. Fonbnk is the only active provider today, while future card or MiniPay card providers can use the same `onramp_sessions.provider`, `provider_order_id`, and `provider_metadata` fields.

Fonbnk request body:
```json
{
  "method": "fonbnk",
  "countryIsoCode": "KE",
  "paymentChannel": "mobile_money",
  "carrierCode": "safaricom",
  "email": "payer@example.com"
}
```

`email` is required by the current Fonbnk flow.

### `GET /api/payments`

Payment history for the authenticated user or agent. This endpoint currently returns payments for links owned by that authenticated user or agent; it is not a payer-side sent-payments feed.

Auth: Privy user or ERC-8004 agent.

Query params: `?cursor=<iso-timestamp>&limit=20&status=confirmed&token=USDC`

---

## Fonbnk Onramp

### `GET /api/onramp/fonbnk/config`

Returns available carriers and rates for a given country. The current frontend should treat this as a USDC/USDT-only fiat path; `USDm` links should not offer Fonbnk.

Query params: `?country=KE`

Response:
```json
{
  "country": "KE",
  "carriers": [
    { "id": "safaricom", "name": "Safaricom", "limits": { "min": 1, "max": 100 } },
    { "id": "airtel", "name": "Airtel", "limits": { "min": 1, "max": 50 } }
  ],
  "rates": {
    "USDC": 0.98,
    "USDT": 0.98
  }
}
```

### `POST /api/onramp/fonbnk/webhook`

Fonbnk payment confirmation webhook. Called by Fonbnk when payment is settled.

Authentication: `x-api-key` header.

```json
{
  "sessionId": "onramp_xyz",
  "status": "completed",
  "txHash": "0x...",
  "amount": "10.00",
  "token": "USDC"
}
```

---

## x402 Endpoints (Agent-to-Agent)

Protected API endpoints that return HTTP 402 Payment Required.

### `GET /api/x402/data`

Example pay-per-task endpoint. Returns data after payment.

Auth: `x-paygrid-x402-proof` header.

Example proof:
```json
{
  "resource": "/api/x402/data",
  "chainId": 11142220,
  "token": "USDC",
  "amount": "0.10",
  "txHash": "0x...",
  "payer": "0x..."
}
```

Flow:
1. Agent requests `/api/x402/data`
2. Server returns `402 Payment Required` with payment challenge
3. Agent pays USDC via x402
4. Agent retries request with payment proof
5. Server returns data

---

## ERC-8004 Auth

Agent-authenticated endpoints use signed headers rather than a session cookie.

Required headers:

- `x-erc8004-agent-id`
- `x-erc8004-address`
- `x-erc8004-timestamp`
- `x-erc8004-nonce`
- `x-erc8004-signature`

Signed message format:

```text
paygrid:erc8004:<agentId>:<address>:<METHOD>:<path>:<timestamp>:<nonce>
```

The backend lowercases the address, uppercases the method, verifies the signature with `viem.verifyMessage`, and rejects stale timestamps older than 5 minutes.

---

## Error Format

All errors return a consistent JSON structure:

```json
{
  "error": {
    "code": "INVALID_TOKEN",
    "message": "Token USDCX is not supported. Use USDm, USDC, or USDT.",
    "details": {}
  }
}
```

### Error codes

| HTTP | Code | Description |
|------|------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid request body or params |
| 400 | `INVALID_TOKEN` | Token not in supported list |
| 400 | `INVALID_AMOUNT` | Amount ≤ 0 or exceeds max |
| 400 | `UNSUPPORTED_METHOD` | Payment method not accepted by link |
| 401 | `UNAUTHORIZED` | Missing or invalid auth |
| 403 | `FORBIDDEN` | Not the link owner |
| 404 | `NOT_FOUND` | Link/agent/user not found |
| 409 | `ALREADY_PAID` | Link already settled |
| 410 | `EXPIRED` | Link past expiration |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 502 | `FONBNK_ERROR` | Fonbnk API unavailable |
| 402 | `PAYMENT_REQUIRED` | x402 payment challenge |

---

## Pagination

All list endpoints use cursor-based pagination:

Query: `?cursor=<id>&limit=20`

```json
{
  "data": [ ... ],
  "pagination": {
    "nextCursor": "link_xyz",
    "hasMore": true
  }
}
```

---

## Rate Limiting

- 100 requests per minute per IP on public endpoints
- 300 requests per minute for authenticated users
- Webhook endpoints: provider-specific throttling (Fonbnk: up to 10/sec)
- Headers: `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## Webhook Retry Strategy (Fonbnk)

Fonbnk webhooks are idempotent:

1. Fonbnk POSTs to `/api/onramp/fonbnk/webhook`
2. Paygrid acknowledges with 200 if `onrampTxId` is new
3. If already processed (duplicate), return 200 (idempotent)
4. If Fonbnk doesn't receive 200, it retries up to 3 times with 5s intervals
5. Backend checks on-chain tx before marking session `completed`
