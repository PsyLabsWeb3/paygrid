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
- `get_agent_capabilities`
- `get_agent_connection_guide`
- `get_celo_defi_context`
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
- Agent card: `https://mcp.celopaygrid.xyz/.well-known/agent.json`.
- Supported trust/reputation fields.
- x402 support for monetized API calls.
- Self Protocol Agent ID status once the Self App verification flow is completed.

## Self Protocol Agent ID

Paygrid uses ERC-8004 for onchain agent identity and supports Self Protocol metadata for sybil-resistant identity status.

The hosted MCP reads these optional environment variables:

```bash
SELF_AGENT_ID=
SELF_AGENT_ADDRESS=
SELF_VERIFICATION_STATUS=pending
SELF_VERIFICATION_URL=
```

Use `pending` until the current Paygrid mainnet agent wallet completes the Self App flow. After verification, set `SELF_VERIFICATION_STATUS=verified` and redeploy/recreate the MCP service so the public metadata advertises `self-agent-id` in `supportedTrust`.
