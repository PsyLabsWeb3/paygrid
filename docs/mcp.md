# Paygrid MCP

Paygrid MCP exposes Paygrid as agent spend infrastructure on Celo.

## Transports

- Local stdio: for builders and agents that keep their own ERC-8004 signing key locally.
- HTTP remote: for hosted read-only tools and API-key protected write tools.

## Tools

- `create_payment_request`
- `get_payment_request`
- `verify_payment`
- `list_agent_requests`
- `create_card_checkout`
- `pay_x402_endpoint`
- `get_supported_stablecoins`
- `get_agent_profile`
- `treasury_report`

## Auth

Local write tools sign Paygrid backend requests with the configured ERC-8004 agent key:

```bash
AGENT_PRIVATE_KEY=0x...
ERC8004_AGENT_ID=...
BACKEND_URL=https://api.celopaygrid.xyz
```

Remote HTTP write tools require:

```bash
PAYGRID_MCP_API_KEY=sk_...
```

Clients send either:

```text
Authorization: Bearer sk_...
```

or:

```text
X-API-Key: sk_...
```

## Frontier Metadata

ERC-8004 metadata should include:

- Paygrid agent wallet.
- API endpoint: `https://api.celopaygrid.xyz`.
- MCP endpoint: `https://mcp.celopaygrid.xyz/mcp`.
- Supported trust/reputation fields.
- x402 support for monetized API calls.
