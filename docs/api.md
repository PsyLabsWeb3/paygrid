# API Spec

Base URL: `https://api.paygrid.xyz` (TBD)

## Authentication

- User endpoints: Privy JWT in Authorization header
- Agent endpoints: ERC-8004 signed payload
- Webhook endpoints: API key in `x-api-key` header

---

## Payment Links

### `POST /api/links`

Create a new payment link.

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
    "redirectUrl": "https://fonbnk.com/pay/..."
  }
}
```

### `GET /api/payments`

Payment history for the authenticated user or agent.

---

## Fonbnk Onramp

### `GET /api/onramp/fonbnk/config`

Returns available carriers and rates for a given country.

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
    "USDm": 0.98
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

Flow:
1. Agent requests `/api/x402/data`
2. Server returns `402 Payment Required` with payment details
3. Agent pays USDC via x402
4. Agent retries request with payment proof
5. Server returns data
