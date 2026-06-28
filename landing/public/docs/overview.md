# Celo PayGrid Overview

Celo PayGrid is an MCP-based payment execution and verification layer for AI agents on Celo Mainnet.

This document describes the current production surface. Planned features are intentionally separated from available capabilities.

## Production endpoints

| Resource | URL |
|---|---|
| MCP endpoint | `https://mcp.celopaygrid.xyz/mcp` |
| Agent metadata | `https://mcp.celopaygrid.xyz/.well-known/paygrid-agent.json` |
| API health | `https://api.celopaygrid.xyz/health` |
| MCP health | `https://mcp.celopaygrid.xyz/health` |
| Landing | `https://web.celopaygrid.xyz` |

## Network

| Item | Value |
|---|---|
| Network | Celo Mainnet |
| Chain ID | `42220` |
| RPC used by production services | `https://forno.celo.org` |
| Agent ID standard | ERC-8004 |
| Discovery tool | `get_agent_capabilities` |

## Current production capabilities

Celo PayGrid currently supports:

- remote MCP discovery;
- MCP tool listing;
- payment request creation;
- payment request lookup;
- payment verification;
- automatic stablecoin swap quotes and payments;
- agent payment activity review;
- supported stablecoin discovery;
- card checkout preparation through the existing provider abstraction;
- x402 endpoint calling with caller-provided payment headers;
- public agent metadata discovery;
- Celo Mainnet settlement verification.

The core production flow is:

1. An agent or builder connects to the Celo PayGrid MCP endpoint.
2. The agent calls `get_agent_capabilities` or `tools/list`.
3. The agent creates a payment request.
4. A payer pays through the Celo PayGrid checkout with USDC, USDT or USDm.
5. If the payer token differs from the requested token, Paygrid quotes and executes a Mento-routed swap.
6. Celo PayGrid indexes the onchain settlement.
7. The agent calls `verify_payment` to confirm final state.

## Automatic stablecoin swaps

Payment links settle in the token selected by the creator, while payers can use any supported stablecoin:

| Token | Decimals | Role |
|---|---:|---|
| USDC | 6 | Supported payer and settlement token |
| USDT | 6 | Supported payer and settlement token |
| USDm | 18 | Supported payer and settlement token |

If a link requests USDC and the payer only has USDT, Paygrid builds a `USDT -> USDC` payment. Mento is the primary route on Celo; Uniswap can be configured as a fallback. The recipient always receives the token requested by the link.

Agents can use `quote_payment_request` to inspect the route and `pay_payment_request` to prepare the approval and payment transactions.

## Mainnet contracts

| Contract | Address |
|---|---|
| PaygridLink | `0x31Aa9Ba23e4CAC3f41d88fb1C904067c0b3dda89` |
| PaygridRouterV2 | `0x8d290c97100f0e87e04Efd1a790F27004fA3f08B` |
| Mento Router | `0x4861840C2EfB2b98312B0aE34d86fD73E8f9B6f6` |
| Treasury Safe | `0xc0C019DCeCE7a3a235Ab520F394A57c132F90cD6` |

## ERC-8004 identity

| Item | Value |
|---|---|
| Agent ID | `9497` |
| Agent wallet | `0x0AcF80b591eA0fE2cf9b1108ba9E4b278f3330Ce` |
| Metadata URI | `https://mcp.celopaygrid.xyz/.well-known/paygrid-agent.json` |
| ERC-8004 Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Self Protocol Agent ID | `172` |
| Self agent address | `0xEf3481bcDd48Db5FFdaF77A39F5f64BaDC957316` |

Verify the token URI:

```bash
cast call 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 \
  "tokenURI(uint256)(string)" 9497 \
  --rpc-url https://forno.celo.org
```

## Self Protocol identity

Celo PayGrid supports Self Protocol Agent ID metadata in the MCP service. The current public state is `verified` for Self Agent ID `172`, and the public MCP metadata advertises `self-agent-id` in `supportedTrust` when the hosted MCP env is configured with the verified Self values.

## Current limitations

Celo PayGrid does not currently claim support for:

- advanced spending policies;
- ERP automation;
- enterprise reconciliation;
- guaranteed fraud protection;
- banking compliance;
- insurance;
- automatic approvals.

Those areas are roadmap items and should not be treated as current production capabilities.
