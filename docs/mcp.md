# Paygrid MCP

Paygrid MCP exposes Paygrid as agent spend infrastructure on Celo.

## Claimable gift tools

- `create_gift`
- `quote_gift_funding`
- `prepare_gift_funding`
- `get_gift`
- `verify_gift_claim`
- `prepare_gift_refund`
- `get_gift_leaderboard`

`create_gift` returns a bearer claim URL. Agents must not log it publicly or expose it outside the intended delivery channel.

## Transports

- Local stdio: for builders and agents that keep their own ERC-8004 signing key locally.
- HTTP remote: for hosted read-only tools and API-key protected write tools.

## Tools

- `create_payment_request`
- `get_payment_request`
- `quote_payment_request`
- `pay_payment_request`
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
- `get_treasury_quant_status`
- `list_treasury_quant_positions`
- `list_treasury_quant_signals`
- `pause_treasury_quant_agent`
- `resume_treasury_quant_agent`
- `close_treasury_quant_position`

## Stablecoin swaps

Paygrid MCP supports swap-aware payments for USDC, USDT and USDm.

Payment links still settle in the token selected by the creator. If a payer or agent wants to pay with a different supported stablecoin, the agent can first call `quote_payment_request` and then `pay_payment_request`.

Default guardrails:

- supported payer tokens: `USDC`, `USDT`, `USDm`;
- default max slippage: `100` bps;
- no payment if the quote expires;
- no payment if the link is no longer active;
- no unsupported assets or CELO user-facing payment option.

Mento is the primary route for stablecoin conversion on Celo. Uniswap can be configured as a fallback route by backend environment variable.

Example agent flow:

```text
get_payment_request -> quote_payment_request -> pay_payment_request -> verify_payment
```

Mainnet swap proof: [`0xef8a70228255479df5b42ad57aa708a14b108faff4725c0cbcb4e1a4439ce4d5`](https://celoscan.io/tx/0xef8a70228255479df5b42ad57aa708a14b108faff4725c0cbcb4e1a4439ce4d5) shows a USDT payer-token payment routed through Mento and settled to the recipient in USDC via `PaygridRouterV2`.

Example:

```json
{
  "paymentRequestId": "cce4b97b-74a8-4443-aab2-4e0af7308f90",
  "payerToken": "USDT",
  "maxSlippageBps": 100,
  "preferExactToken": true
}
```

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
