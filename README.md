# Paygrid

**Stablecoin payment links for agents and humans on Celo.**

Paygrid is a [MiniPay](https://docs.minipay.xyz) MiniApp that enables agent-to-agent, agent-to-human, and human-to-agent stablecoin payments. Create a payment link, share it anywhere, and receive USDC/USDT/USDm instantly — no banks, no Stripe, no borders. Built for the autonomous agent economy and for anyone who needs to send or receive money globally.

---

## How it works

1. **Create** — generate a payment link from MiniPay with amount, token, and optional description. Accepts crypto, fiat, or both.
2. **Share** — send it via WhatsApp, email, or social media.
3. **Pay with crypto** — the payer opens the link, connects their wallet, and pays in stablecoins.
4. **Pay with fiat** — no crypto? The payer uses the Fonbnk onramp to pay with mobile airtime or card, converted to stablecoin automatically.
5. **Settle** — funds arrive instantly on Celo. Paygrid takes 0.5% fee.

### For AI agents

- **Agent-to-Agent**: Protected APIs return HTTP 402 Payment Required. The agent pays via x402, gets the response. No API keys, no manual billing.
- **Agent-to-Human**: An agent creates payment links and pays humans (freelancers, team members) automatically.
- **Human-to-Agent**: A human pays an agent for services — via crypto or fiat (Fonbnk).

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14 (App Router) + Tailwind CSS |
| Blockchain | Viem v2 + Wagmi |
| Contracts | Foundry (Solidity) — PaygridRouter.sol + PaygridLink.sol |
| Backend | REST API + webhooks + Supabase (PostgreSQL) |
| Agent | Vercel AI SDK + thirdweb/x402 + @chaoschain/sdk (ERC-8004) |
| Auth | Privy |
| Onramper | Fonbnk (airtime → crypto, no-KYC) |
| Network | Celo Mainnet (chainId: 42220) |

---

## Supported stablecoins

| Token | Address | Decimals |
|-------|---------|----------|
| USDm (cUSD) | `0x765DE816845861e75A25fCA122bb6898B8B1282a` | 18 |
| USDC | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` | 6 |
| USDT | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` | 6 |

---

## Getting started

```bash
# Install dependencies
cd minipay && npm install

# Start dev server
npm run dev

# Expose for MiniPay testing
ngrok http 3000

# Build contracts
cd contracts && forge build

# Run contract tests
forge test --fork-url https://forno.celo.org
```

### Environment variables

```bash
FONBNK_API_KEY=           # Fonbnk onramp integration
NEXT_PUBLIC_PRIVY_APP_ID= # Privy auth
SUPABASE_URL=             # Database
SUPABASE_ANON_KEY=        # Database
AGENT_PRIVATE_KEY=        # ERC-8004 agent wallet (never commit)
```

---

## Repo structure

```
paygrid/
├── contracts/    # Solidity smart contracts (Foundry)
├── backend/      # REST API, webhooks, on-chain indexer
├── agent/        # Autonomous AI agent (ERC-8004 + x402)
├── minipay/      # Next.js MiniApp frontend
├── docs/         # Technical specifications
└── tasks/        # Active work items per module
```

Read `SPEC.md` for the full project brief or `AGENTS.md` if you're an AI agent contributing to this repo.

---

## Hackathon

Built by [@PsyLabs_io](https://x.com/PsyLabs_io) for the **Onchain Agents Hackathon — Celo** (May 22 – June 15, 2026).

| Registration | Link |
|-------------|------|
| ERC-8004 Agent ID | **#9113** |
| 8004scan | https://8004scan.io/agents/celo/9113 |
| Self Agent ID | ✅ Verified (proof-of-human) |
| Owner | `0xD4683314A013792fe8840E4171dC4692E317617B` |

- [ERC-8004 Agent Trust Protocol](https://www.8004.org)
- [x402 Payment Protocol](https://www.x402.org)
- [MiniPay Documentation](https://docs.minipay.xyz)
- [Celo Documentation](https://docs.celo.org)
- [Fonbnk Onramp](https://fonbnk.com)
- [Self Protocol](https://self.xyz)
