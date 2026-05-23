# Paygrid — Project Spec

Source of truth for the project. All devs and agents must read this file before touching any code.

## Brief

Paygrid is a MiniApp for MiniPay that enables agent-to-agent, agent-to-human, and human-to-agent stablecoin payments on Celo — payment links, instant settlement, cross-border coordination.

- Platform: MiniApp on MiniPay (Opera Mini / standalone)
- Network: Celo Mainnet (chainId: 42220)
- Users: freelancers, developers, AI agents, businesses
- Hackathon: Onchain Agents Hackathon — Celo (May 22 – June 15, 2026)
- Team: @PsyLabs_io
- Agent ID: #9113 (ERC-8004 Mainnet)
- 8004scan: https://8004scan.io/agents/celo/9113

## Problem

Traditional payment rails (Stripe, PayPal, SWIFT) are slow, expensive, and not programmable. AI agents cannot pay or get paid without human intermediaries. There is no native payment layer for the autonomous agent economy.

## Solution

Paygrid provides a programmable stablecoin payment layer on Celo with instant settlement. Agents pay agents via x402. Agents pay humans via payment links. Humans pay agents via payment links with fiat onramp. Humans pay humans directly — all through one unified MiniApp.

## Use Cases

Four interaction flows in priority order:

### 1. Agent-to-Agent — Pay-per-Task API Monetization (priority 1)

Developers and companies expose services or APIs protected with x402. An AI agent makes a request, receives a 402 Payment Required, automatically pays in USDC, and gets the response. No account setup, no manual invoicing. Fee: 0.5% charged to the recipient.

### 2. Agent-to-Human — Agent as Payer / Treasurer (priority 2)

An autonomous agent manages payments for a team or protocol: generates invoices, creates payment links, executes payouts to humans, and reports on-chain activity. The agent operates with its own wallet registered in ERC-8004. Humans receive stablecoins instantly without needing a wallet — the agent handles settlement.

### 3. Human-to-Agent — Monetizing Agent Services (priority 3)

A human pays an AI agent for services (research, automation, data processing). The agent exposes a payment link or x402 endpoint. The human pays via crypto (MiniPay) or fiat (Fonbnk airtime onramp). The agent receives USDC and delivers the result.

### 4. Human-to-Human — Global Freelancer (priority 4)

Anyone generates a payment link from MiniPay and shares it via WhatsApp, email, or social media. The client pays from any compatible wallet — or with local currency via Fonbnk. The freelancer receives USDm/USDC/USDT instantly, without a bank account.

## Business Model

- Transaction fee: 0.5% charged to the recipient on each received payment
- Roadmap (future): volume API tier, multi-stablecoin conversion spread, white-label

## Fiat Onramp (Fonbnk)

Payers without crypto can settle payment links with local currency via Fonbnk (airtime prepago → stablecoin on Celo).

- Provider: Fonbnk (https://fonbnk.com)
- No KYC: identity verification is handled by the mobile carrier
- Coverage: 150+ countries (Africa, LATAM, Asia, Middle East)
- Flow: payer selects "Pay with mobile" → picks carrier → tops up airtime → Fonbnk converts to stablecoin → Paygrid receives the payment
- Integration: Fonbnk widget embedded in the payment link UI
- Constraint: Fonbnk only operates in countries with supported carriers — validate availability before offering fiat option

## System Modules

| Module | Description |
|--------|-------------|
| Module 1 — Smart Contracts | PaygridRouter + PaygridLink on Celo |
| Module 2 — Backend API | REST + webhooks + on-chain indexer |
| Module 3 — Agent | ERC-8004 wallet + Vercel AI SDK + x402 |
| Module 4 — MiniApp Frontend | Next.js, MiniPay auto-connect, links and payments UI |
| Module 5 — Database | Supabase — links, payments, users, agents |
| Module 6 — Skills / AI Context | Celopedia installed in .agents/skills/ |
| Module 7 — Hackathon Registration | ERC-8004 agentId, Karma, tweet, Self Agent ID |
| Module 8 — Fiat Onramp | Fonbnk integration for local currency payments |

## Supported Tokens

| Token | Address | Decimals | feeCurrency |
|-------|---------|----------|-------------|
| USDm (cUSD) | `0x765DE816845861e75A25fCA122bb6898B8B1282a` | 18 | same |
| USDC | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` | 6 | `0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B` (adapter) |
| USDT | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` | 6 | `0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72` (adapter) |

## Critical Constraints

### MiniPay
- Legacy transactions only — no maxFeePerGas or maxPriorityFeePerGas
- No personal_sign or eth_signTypedData
- UI only shows USDm / USDC / USDT — never CELO
- Identify users by phone number, not 0x address
- Bundle under 2MB, design for 360x640
- Testing requires physical device + ngrok

### Fonbnk
- Only available in countries with supported carriers — validate via API before offering fiat option
- Onramp amount limits depend on carrier — display limits in UI
- Settlement time varies by carrier (typically 1-5 minutes)

### Hackathon
- Agent must generate real on-chain transactions
- ERC-8004 agentId required before registration tweet
- Final submission via Celopedia Skill in the last week
- Deadline: June 15, 2026 — 9 AM GMT

## Repo Structure

```
paygrid/
├── SPEC.md
├── AGENTS.md
├── .agents/skills/celopedia-skill/
├── docs/architecture.md
├── docs/contracts.md
├── docs/api.md
├── docs/data-model.md
├── tasks/01-contracts.md
├── tasks/02-backend.md
├── tasks/03-agent.md
├── tasks/04-minipay.md
├── tasks/05-registration.md
├── contracts/
├── minipay/
├── backend/
└── agent/
```

## Key Links

- Celopedia Skills: https://github.com/celo-org/celopedia-skills
- ERC-8004: https://www.8004.org
- x402 Protocol: https://www.x402.org
- MiniPay Docs: https://docs.minipay.xyz
- Celo Docs: https://docs.celo.org
- 8004scan: https://8004scan.io/agents/celo/9113
- Fonbnk: https://fonbnk.com
